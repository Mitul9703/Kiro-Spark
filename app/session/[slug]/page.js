import { SessionPage } from "../../../components/session-page";

export default async function SessionRoute({ params }) {
  const { slug } = await params;
  return <SessionPage slug={slug} />;
}
