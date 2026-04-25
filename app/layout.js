import "./globals.css";
import { AppProvider } from "../components/app-provider";

export const metadata = {
  title: "SimCoach",
  description: "AI rehearsal room with live avatar sessions and agent-specific coaching.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
