import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

interface Project {
  id: string
  slug: string
  name: string
  custom_domain: string | null
  default_locale: string
  status: string
  created_at: string
  tenants: { display_name: string; slug: string } | null
}

const statusStyles: Record<string, string> = {
  active:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  preview:  'bg-blue-50 text-blue-700 border-blue-200',
  draft:    'bg-zinc-100 text-zinc-500 border-zinc-200',
  inactive: 'bg-red-50 text-red-600 border-red-200',
}

export default async function DashboardPage() {
  const supabase = createAdminClient()

  const { data: projects, error } = await supabase
    .from('projects')
    .select('*, tenants(display_name, slug)')
    .order('created_at', { ascending: false })

  return (
    <div className="px-10 py-10 max-w-5xl">

      {/* Header */}
      <div className="mb-10">
        <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">
          Projects
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          All active client websites on the Abluo platform.
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load projects: {error.message}
        </div>
      )}

      {/* Empty state */}
      {!error && (!projects || projects.length === 0) && (
        <div className="rounded border border-zinc-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-zinc-400">No projects yet.</p>
        </div>
      )}

      {/* Project list */}
      {projects && projects.length > 0 && (
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white overflow-hidden">
          {(projects as Project[]).map((project) => {
            const previewUrl = `https://preview.abluo.app/${project.slug}`
            const studioUrl  = `/studio`

            return (
              <div
                key={project.id}
                className="flex items-center justify-between px-6 py-5 hover:bg-zinc-50 transition-colors"
              >
                {/* Left: project info */}
                <div className="flex items-center gap-5">
                  {/* Status dot */}
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                    project.status === 'active'  ? 'bg-emerald-400' :
                    project.status === 'preview' ? 'bg-blue-400' :
                    project.status === 'draft'   ? 'bg-zinc-300' : 'bg-red-400'
                  }`} />

                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-zinc-900">
                        {project.name}
                      </span>
                      <span className={`text-[10px] font-medium tracking-wider uppercase px-2 py-0.5 rounded border ${statusStyles[project.status] ?? statusStyles.draft}`}>
                        {project.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-zinc-400 font-mono">
                        {project.slug}
                      </span>
                      {project.custom_domain && (
                        <>
                          <span className="text-zinc-200">·</span>
                          <span className="text-xs text-zinc-400">
                            {project.custom_domain}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2">
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-zinc-500 border border-zinc-200 hover:border-zinc-400 hover:text-zinc-900 transition-colors"
                  >
                    Preview
                    <span className="text-[10px] opacity-50">↗</span>
                  </a>
                  <a
                    href={studioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-zinc-500 border border-zinc-200 hover:border-zinc-400 hover:text-zinc-900 transition-colors"
                  >
                    Studio
                    <span className="text-[10px] opacity-50">↗</span>
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
