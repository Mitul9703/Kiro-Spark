import { SessionDetailPage } from "../../../../../components/session-detail-page";

export default async function SessionDetailRoute({ params }) {
  const { slug, sessionId } = await params;
  return <SessionDetailPage slug={slug} sessionId={sessionId} />;
}
