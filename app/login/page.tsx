import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <LoginForm
        googleEnabled={googleEnabled}
        urlError={error === "AccessDenied" ? "denied" : error ? "other" : null}
      />
    </main>
  );
}
