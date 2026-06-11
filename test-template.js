// Quick test to verify template value() functions work with projectSlug parameter

// Manually define the template to test (copying from schema.ts)
const eventTemplate = {
  id: 'event',
  title: 'Event',
  schemaType: 'event',
  parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
  value: ({ projectSlug } = {}) => {
    console.log(`[TEST] event template value() received:`, { projectSlug })
    const result = {
      projectSlug,
      slug: { _type: 'slug', current: '' },
      status: 'upcoming',
      startDate: new Date().toISOString(),
    }
    console.log(`[TEST] event template value() returns:`, result)
    return result
  },
}

const homePageTemplate = {
  id: 'homePage',
  title: 'Home Page',
  schemaType: 'homePage',
  parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
  value: ({ projectSlug } = {}) => {
    console.log(`[TEST] homePage template value() received:`, { projectSlug })
    const result = {
      projectSlug,
      sections: [],
    }
    console.log(`[TEST] homePage template value() returns:`, result)
    return result
  },
}

// Test 1: Call event template with projectSlug
console.log('\n=== TEST 1: Event Template ===')
console.log('Calling with { projectSlug: "livener-main" }')
const eventResult = eventTemplate.value({ projectSlug: 'livener-main' })
console.log('Result:', eventResult)
console.log('projectSlug in result:', eventResult.projectSlug)

// Test 2: Call homePage template with projectSlug
console.log('\n=== TEST 2: Home Page Template ===')
console.log('Calling with { projectSlug: "livener-main" }')
const homeResult = homePageTemplate.value({ projectSlug: 'livener-main' })
console.log('Result:', homeResult)
console.log('projectSlug in result:', homeResult.projectSlug)

// Test 3: Call with no parameters (what might be happening in Sanity)
console.log('\n=== TEST 3: No Parameters (Problem Case) ===')
console.log('Calling event template with no parameters')
const eventNoParams = eventTemplate.value()
console.log('Result:', eventNoParams)
console.log('projectSlug in result:', eventNoParams.projectSlug)
console.log('Is projectSlug undefined?', eventNoParams.projectSlug === undefined)
