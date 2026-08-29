import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";


// ---------------------------------------------------------------------------
// Project-scoping guard (WARN ONLY — does not fail the build).
//
// Every Sanity read should go through tenantClient(tenantSlug).fetchForTenant,
// which injects the project scope. Importing the raw `sanityClient` export
// bypasses that scoping. This is a warning, not an error, so the existing
// call sites can be migrated deliberately rather than all at once — see
// .github/sanity-client-callsites.md for the point-in-time worklist.
// ---------------------------------------------------------------------------
const RAW_SANITY_CLIENT_MESSAGE =
  "Use tenantClient(tenantSlug).fetchForTenant — the raw sanityClient bypasses project scoping. See the isolation plan.";

const rawSanityClientGuard = {
  name: "abluo/no-raw-sanity-client",
  rules: {
    "no-restricted-imports": [
      "warn",
      {
        paths: [
          {
            name: "@/lib/sanity/client",
            importNames: ["sanityClient"],
            message: RAW_SANITY_CLIENT_MESSAGE,
          },
          // Relative spellings of the same module (the codebase uses the "@/"
          // alias everywhere today, but these keep the guard honest).
          {
            name: "./client",
            importNames: ["sanityClient"],
            message: RAW_SANITY_CLIENT_MESSAGE,
          },
          {
            name: "../sanity/client",
            importNames: ["sanityClient"],
            message: RAW_SANITY_CLIENT_MESSAGE,
          },
        ],
      },
    ],
  },
};

// Files that are allowed to touch the raw client.
const rawSanityClientExemptions = {
  name: "abluo/no-raw-sanity-client-exemptions",
  files: [
    // The module that defines and re-exports the client.
    "src/lib/sanity/client.ts",
    // The tenant-scoped chokepoint: this IS the wrapper the rule points at,
    // so it must import the raw client to do its job.
    "src/lib/api/tenant-scoped-sanity.ts",
    // Tests: they import the raw client in order to mock/stub it or to assert
    // on scoping behaviour. Warning here would add permanent noise to the
    // worklist without describing a real production scoping bypass.
    "**/__tests__/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
  ],
  rules: {
    "no-restricted-imports": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  rawSanityClientGuard,
  rawSanityClientExemptions,
]);

export default eslintConfig;
