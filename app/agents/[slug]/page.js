import { AgentDetailPage } from "../../../components/agent-detail-page";

export default async function AgentPage({ params }) {
  const { slug } = await params;
  return <AgentDetailPage slug={slug} />;
}
