import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Chat from "@/components/Chat";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <Chat me={{ id: session.user.id, name: session.user.name ?? "you" }} />
  );
}
