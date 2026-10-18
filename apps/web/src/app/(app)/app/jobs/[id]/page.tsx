import { JobScreen } from "@/screens/jobs/job-screen";

export default async function JobPage({ params }: PageProps<"/app/jobs/[id]">) {
  const { id } = await params;
  return <JobScreen jobId={id} />;
}
