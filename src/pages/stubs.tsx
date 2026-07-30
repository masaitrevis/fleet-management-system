// Route stub pages — replaced by page agents per design/*.md docs.

import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Construction } from 'lucide-react';

export function StubPage({ title, hint }: { title: string; hint?: string }) {
  const params = useParams();
  const suffix = params.id ? ` · ${params.id}` : '';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-[1520px] p-6"
    >
      <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-border bg-white px-6 py-20 text-center shadow-card">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-50 text-navy-800">
          <Construction size={24} />
        </span>
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">{title}{suffix}</h1>
        <p className="max-w-md text-[14px] leading-[22px] text-ink-400">
          {hint ?? 'Module scaffolded — the page agent implements this screen from its design doc.'}
        </p>
      </div>
    </motion.div>
  );
}

export const stub = (title: string, hint?: string) => {
  const C = () => <StubPage title={title} hint={hint} />;
  C.displayName = `Stub(${title})`;
  return C;
};
