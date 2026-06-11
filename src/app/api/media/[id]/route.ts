import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
})

// PATCH /api/media/[id] — Update mediaAsset metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, altText, description, tags } = body

    // Build update object - handle both localized and non-localized formats
    const updateObj: any = {}
    if (name !== undefined) updateObj.name = name
    if (altText !== undefined) {
      // Ensure altText is an object with language keys
      if (typeof altText === 'string') {
        updateObj.altText = { en: altText }
      } else {
        updateObj.altText = altText
      }
    }
    if (description !== undefined) {
      // Ensure description is an object with language keys
      if (typeof description === 'string') {
        updateObj.description = { en: description }
      } else {
        updateObj.description = description
      }
    }
    if (tags !== undefined) {
      updateObj.tags = Array.isArray(tags) ? tags.map((tag: string) => tag.toLowerCase().trim()) : []
    }

    if (Object.keys(updateObj).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      )
    }

    // Update document
    try {
      await client.patch(id).set(updateObj).commit()
    } catch (patchError: any) {
      console.error('Sanity PATCH error:', {
        message: patchError.message,
        statusCode: patchError.statusCode,
        response: patchError.response?.body || patchError,
        updateObj,
      })
      return NextResponse.json(
        {
          success: false,
          error: patchError.message,
          details: patchError.response?.body || patchError.toString(),
        },
        { status: patchError.statusCode || 500 }
      )
    }

    // Fetch full document with asset metadata
    let fullAsset = await client.fetch(
      `*[_id == "${id}"][0] {
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

    return NextResponse.json({ success: true, data: fullAsset })
  } catch (error) {
    console.error(`PATCH /api/media/[id] error:`, error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    )
  }
}

// DELETE /api/media/[id] — Delete mediaAsset document
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Delete document
    await client.delete(id)

    return NextResponse.json({ success: true, data: { _id: id, deleted: true } })
  } catch (error) {
    console.error(`DELETE /api/media/[id] error:`, error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 }
    )
  }
}
