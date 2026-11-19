import { Home } from '@/components/Home';
import { effectiveStreamMode, env, publicConfig } from '@/lib/env';
import { PRODUCTS, productView, type ProductCode } from '@/lib/products';
import { getServerSupabase, loadSettings } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = await getServerSupabase();
  const settings = await loadSettings(supabase);
  const config = publicConfig();
  const codes = Object.keys(PRODUCTS) as ProductCode[];
  const products = {
    SIMULATED: codes.map((c) => productView(c, 'SIMULATED', config.currency, env.productPricesJson)),
    REAL: codes.map((c) => productView(c, 'REAL', config.currency, env.productPricesJson)),
  };
  return (
    <Home
      config={config}
      initialSettings={settings}
      initialMode={effectiveStreamMode(settings)}
      products={products}
      consoleProfile={env.consoleProfile}
    />
  );
}
