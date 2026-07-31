import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { buildMediaFilter } from '@/lib/media/media-filter'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
})

// GET /api/media — List media assets with filters & pagination
export async function GET(request: NextRequest) {
  try {
    // ADR-015 Phase 1 (slice 3b): admin-only surface. Requires
    // platform_role === 'abluo_admin'; requireAbluoAdmin collapses unauth and
    // authenticated-non-admin to null (single honest 403).
    const actor = await requireAbluoAdmin()
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const tenant = searchParams.get('tenant')
    const project = searchParams.get('project')
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || []
    const search = searchParams.get('search') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build parameterized GROQ filter (ADR-015 R2 — no interpolated request
    // params in query strings). offset/limit are numeric (parseInt) and are the
    // only interpolated values.
    const { filter, params } = buildMediaFilter({ tenant, project, tags, search })

    // Fetch count
    const countQuery = `count(*[${filter}])`
    const totalCount = await client.fetch<number>(countQuery, params)

    // Fetch paginated results with asset metadata
    const query = `*[${filter}] | order(_createdAt desc) [${offset}...${offset + limit}] {
      _id,
      _createdAt,
      name,
      altText,
      description,
      tags,
      uploadedBy,
      uploadedByName,
      tenant->{_id, displayName, tenantSlug},
      project->{_id, projectName, projectSlug},
      projectSlug,
      "image": image{
        asset->{
          _id,
          url,
          metadata {
            dimensions { width, height },
            size
          },
          originalFilename
        }
      }
    }`

    let assets = await client.fetch(query, params)

    // Backward compatibility: convert string altText/description to objects
    assets = assets.map((asset: any) => ({
      ...asset,
      altText:
        typeof asset.altText === 'string'
          ? { en: asset.altText, it: '', de: '' }
          : asset.altText || { en: '', it: '', de: '' },
      description:
        typeof asset.description === 'string'
          ? { en: asset.description, it: '', de: '' }
          : asset.description || { en: '', it: '', de: '' },
    }))

    return NextResponse.json({
      success: true,
      data: assets,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    })
  } catch (error) {
    console.error('GET /api/media error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch media' },
      { status: 500 }
    )
  }
}

// POST /api/media/upload — Upload file & create mediaAsset document
export async function POST(request: NextRequest) {
  try {
    // ADR-015 Phase 1 (slice 3b): admin-only surface. Requires
    // platform_role === 'abluo_admin'; requireAbluoAdmin collapses unauth and
    // authenticated-non-admin to null (single honest 403).
    const actor = await requireAbluoAdmin()
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const tenant = formData.get('tenant') as string
    const project = formData.get('project') as string | null
    const name = formData.get('name') as string | null
    const altText = formData.get('altText') as string
    const description = formData.get('description') as string | null
    const tagsJson = formData.get('tags') as string | null
    const uploadedBy = formData.get('uploadedBy') as string | null
    const uploadedByName = formData.get('uploadedByName') as string | null

    // Validation
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }
    if (!tenant) {
      return NextResponse.json({ success: false, error: 'Tenant required' }, { status: 400 })
    }
    if (!altText) {
      return NextResponse.json({ success: false, error: 'Alt text required' }, { status: 400 })
    }

    // Check file size (soft limit 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: `File too large. Max 10MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB` },
        { status: 413 }
      )
    }

    // Upload asset to Sanity
    const buffer = await file.arrayBuffer()
    const uploadedAsset = await client.assets.upload('image', Buffer.from(buffer), {
      filename: file.name,
    })

    // Fetch project slug if project ref provided
    let projectSlug: string | null = null
    if (project) {
      const projectDoc = await client.fetch<{ projectSlug: string }>(
        `*[_type == "project" && _id == $project][0] { projectSlug }`,
        { project }
      )
      projectSlug = projectDoc?.projectSlug || null
    }

    // Parse tags
    const tags = tagsJson ? JSON.parse(tagsJson).map((tag: string) => tag.toLowerCase().trim()) : []

    // Create mediaAsset document
    const mediaAsset = await client.create({
      _type: 'mediaAsset',
      image: {
        _type: 'image',
        asset: { _type: 'reference', _ref: uploadedAsset._id },
      },
      tenant: { _type: 'reference', _ref: tenant },
      ...(project && { project: { _type: 'reference', _ref: project } }),
      ...(projectSlug && { projectSlug }),
      ...(name && { name }),
      tags,
      altText,
      ...(description && { description }),
      ...(uploadedBy && { uploadedBy }),
      ...(uploadedByName && { uploadedByName }),
    })

    // Fetch full document with asset metadata
    let fullAsset = await client.fetch(
      `*[_id == $id][0] {
        _id,
        _createdAt,
        name,
        altText,
        description,
        tags,
        uploadedBy,
        uploadedByName,
        tenant->{_id, displayName, tenantSlug},
        project->{_id, projectName, projectSlug},
        projectSlug,
        "image": image{
          asset->{
            _id,
            url,
            metadata {
              dimensions { width, height },
              size
            },
            originalFilename
          }
        }
      }`,
      { id: mediaAsset._id }
    )

    // Backward compatibility: convert string to objects
    if (fullAsset) {
      fullAsset = {
        ...fullAsset,
        altText:
          typeof fullAsset.altText === 'string'
            ? { en: fullAsset.altText, it: '', de: '' }
            : fullAsset.altText || { en: '', it: '', de: '' },
        description:
          typeof fullAsset.description === 'string'
            ? { en: fullAsset.description, it: '', de: '' }
            : fullAsset.description || { en: '', it: '', de: '' },
      }
    }

    return NextResponse.json({ success: true, data: fullAsset }, { status: 201 })
  } catch (error) {
    console.error('POST /api/media/upload error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
