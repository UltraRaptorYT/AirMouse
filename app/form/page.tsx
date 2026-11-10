import { cookies } from "next/headers";
import Link from "next/link";
import { FilePlus2, LockKeyhole } from "lucide-react";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin-session";
import QuestionBuilder from "./question-builder";
import AdminLogin from "./admin-login";

export const runtime = "nodejs";

export default async function QuestionFormPage() {
  const configured = Boolean(process.env.ADMIN_PASSWORD);
  const cookieStore = await cookies();
  const authorized = isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value);

  return (
    <main className="game-shell min-h-dvh bg-[#eef7f0] p-2 text-[#17211c] sm:p-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-[#52645a] hover:bg-white">
          <span aria-hidden="true">←</span> Back to AirMouse
        </Link>
        <section className="host-panel mt-3 p-4 sm:mt-5 sm:p-10">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#e4f4eb] text-[#228755]">
            {authorized ? <FilePlus2 className="size-7" /> : <LockKeyhole className="size-7" />}
          </div>
          <p className="eyebrow mt-6">Shared game catalogue</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
            {authorized ? "Custom games" : "Admin access"}
          </h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-[#52645a]">
            {authorized
              ? "Find an existing game in the catalogue or create a new one."
              : "Enter the admin password to add questions to the shared game catalogue."}
          </p>
          <div className="mt-8">{authorized ? <QuestionBuilder /> : <AdminLogin configured={configured} />}</div>
        </section>
      </div>
    </main>
  );
}
