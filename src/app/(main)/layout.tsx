import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import BottomNav from "@/components/BottomNav";
import PwaSetup from "@/components/PwaSetup";
import UpdateNotice from "@/components/UpdateNotice";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/onboarding");
  return (
    <div className="mx-auto max-w-lg min-h-dvh pb-24">
      <UpdateNotice />
      {children}
      <BottomNav />
      <PwaSetup />
    </div>
  );
}
