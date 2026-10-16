import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Header from "@/components/Header";
import Reels from "@/components/Reels";

export default async function ReelsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="mx-auto flex h-dvh w-full max-w-xl flex-col">
      <Header active="reels" name={session.user.name ?? "you"} />
      <Reels />
    </div>
  );
}
