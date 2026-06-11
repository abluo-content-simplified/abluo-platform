#!/bin/bash

# Verification script for project ownership assignment
# Run this after creating test documents in Livener to confirm projectSlug is assigned

TOKEN="skKcZ5D6dXzN6LAdQ3K9EmYYRHV4uLrXLAdPq18oc14JAPrtbbVpgofHBfGLn4UggjxuVBZ9IjBGVDka3MBeVZ1Zg42D4M3SZr8D3SAaIdb5jITdWcB88k6QvlV6zgKa0NGd9wRVRXG6OPFwSpcqJpwQlNLFHVUBxtX8GkLkBtzjDOsLQ1Mo"
PROJECT_ID="3n7t84j3"
DATASET="production"

echo "================================"
echo "VERIFYING PROJECT OWNERSHIP"
echo "================================"
echo ""

# Query recent events
echo "1. RECENT EVENTS (should show projectSlug='livener-main'):"
echo ""
curl -s "https://${PROJECT_ID}.api.sanity.io/v1/data/query/${DATASET}?query=*%5B_type%20==%20%22event%22%5D%20%7B%20_id,%20_type,%20_createdAt,%20projectSlug,%20title%20%7D%20%7C%20order(_createdAt%20desc)%20%5B0..2%5D" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -A 2 '"_id"'
echo ""

# Query recent home pages
echo "2. RECENT HOME PAGES (should show projectSlug='livener-main'):"
echo ""
curl -s "https://${PROJECT_ID}.api.sanity.io/v1/data/query/${DATASET}?query=*%5B_type%20==%20%22homePage%22%5D%20%7B%20_id,%20_type,%20_createdAt,%20projectSlug%20%7D%20%7C%20order(_createdAt%20desc)%20%5B0..2%5D" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -A 2 '"_id"'
echo ""

# Query recent posts
echo "3. RECENT BLOG POSTS (should show projectSlug='livener-main'):"
echo ""
curl -s "https://${PROJECT_ID}.api.sanity.io/v1/data/query/${DATASET}?query=*%5B_type%20==%20%22post%22%5D%20%7B%20_id,%20_type,%20_createdAt,%20projectSlug,%20title%20%7D%20%7C%20order(_createdAt%20desc)%20%5B0..2%5D" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -A 2 '"_id"'
echo ""

# Query unassigned content (should be empty)
echo "4. UNASSIGNED CONTENT (should be EMPTY if ownership works):"
echo ""
curl -s "https://${PROJECT_ID}.api.sanity.io/v1/data/query/${DATASET}?query=*%5B(_type%20==%20%22event%22%20%7C%7C%20_type%20==%20%22post%22%20%7C%7C%20_type%20==%20%22homePage%22)%20%26%26%20(projectSlug%20==%20null%20%7C%7C%20projectSlug%20==%20%22%22)%5D%20%7B%20_id,%20_type,%20projectSlug%20%7D" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

echo "================================"
echo "INTERPRETATION:"
echo "✓ If recent events/posts/pages show projectSlug='livener-main' → OWNERSHIP WORKS"
echo "✓ If unassigned content list is empty → OWNERSHIP WORKS"
echo "✗ If projectSlug is null/missing → OWNERSHIP NOT WORKING"
echo "================================"
