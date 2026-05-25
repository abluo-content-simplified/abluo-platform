export default function AdminDashboard() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center gap-4 border-b border-border bg-background px-6">
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
      </header>
      <main className="flex-1 p-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <DashboardCard
            title="Total Clients"
            value="24"
            description="Active client accounts"
          />
          <DashboardCard
            title="Active Projects"
            value="12"
            description="Currently in progress"
          />
          <DashboardCard
            title="Content Items"
            value="156"
            description="Published this month"
          />
        </div>
      </main>
    </div>
  );
}

function DashboardCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <p className="mt-2 text-3xl font-semibold text-card-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
