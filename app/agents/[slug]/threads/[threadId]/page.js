import { ThreadDetailPage } from "../../../../../components/thread-detail-page";

export default async function AgentThreadPage({ params }) {
  const { slug, threadId } = await params;
  return <ThreadDetailPage slug={slug} threadId={threadId} />;
}
