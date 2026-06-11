import { createClient } from '@sanity/client'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const token = process.env.SANITY_API_WRITE_TOKEN

    if (!token) {
      return NextResponse.json({
        success: false,
        error: 'SANITY_API_WRITE_TOKEN not configured',
      })
    }

    const client = createClient({
      projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
      dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
      apiVersion: '2026-05-21',
      token,
      useCdn: false,
    })

    // Try to fetch a single document to verify token works
    const result = await client.fetch('*[_type == "mediaAsset"][0] { _id }', {}, { useCdn: false })

    return NextResponse.json({
      success: true,
      message: 'Token is valid and has read access',
      tokenConfigured: !!token,
      canRead: true,
      tokenPreview: token.substring(0, 10) + '...',
      note: 'To verify write permissions, try updating a document. If you get "Insufficient permissions", regenerate the token with Editor role in Sanity settings.',
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        hint: 'Check that SANITY_API_WRITE_TOKEN is set in .env.local and has Editor permissions in Sanity → Settings → API → Tokens',
      },
      { status: 500 }
    )
  }
}
