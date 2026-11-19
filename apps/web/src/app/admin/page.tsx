import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { configStatus, effectiveStreamMode, env, supabaseConfigured } from '@/lib/env';
import { getServerSupabase, getUserAndRole, loadSettings } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false } };

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-lg place-items-center px-4">
      <div className="w-full rounded-2xl border border-border bg-panel p-6">
        <h1 className="mb-3 text-xl font-black">{title}</h1>
        <div className="space-y-3 text-sm text-muted">{children}</div>
        <a href="/" className="mt-5 inline-block text-sm font-semibold text-accent hover:underline">
          ← Volver al inicio
        </a>
      </div>
    </main>
  );
}

export default async function AdminPage() {
  if (!supabaseConfigured) {
    return <Gate title="Falta configurar Supabase">Definí NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (ver README).</Gate>;
  }
  const supabase = await getServerSupabase();
  const { user, isAdmin } = await getUserAndRole(supabase);
  if (!user) {
    return <Gate title="Iniciá sesión">Entrá con Google desde la página principal y volvé a /admin.</Gate>;
  }
  if (!isAdmin) {
    return (
      <Gate title="Sin permisos de admin">
        <p>Tu usuario no es admin. Para darte permisos, corré esto en el SQL Editor de Supabase:</p>
        <pre className="overflow-x-auto rounded-xl bg-panel-2 p-3 font-mono text-xs text-text">
          {`update public.profiles set role = 'admin'\nwhere id = '${user.id}';`}
        </pre>
      </Gate>
    );
  }
  const settings = await loadSettings(supabase);
  return (
    <AdminDashboard
      siteName={env.siteName}
      initialSettings={settings}
      effectiveMode={effectiveStreamMode(settings)}
      status={configStatus()}
    />
  );
}
