export default function WebsitePage({ params }: { params: { tenant: string; locale: string } }) {
  return <div>Website: {params.tenant}</div>
}
