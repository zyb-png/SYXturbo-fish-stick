import Link from 'next/link';

type WorkspaceMode = 'workflow' | 'handcraft';

interface WorkspaceModeSwitchProps {
  active: WorkspaceMode;
}

export function WorkspaceModeSwitch({ active }: WorkspaceModeSwitchProps) {
  const isHandcraft = active === 'handcraft';

  return (
    <nav
      className="relative inline-grid h-8 min-w-[148px] grid-cols-2 rounded-full border border-amber-300/45 bg-black/55 p-0.5 text-xs font-semibold shadow-[0_0_16px_rgba(245,158,11,0.22)] backdrop-blur"
      aria-label="页面模式切换"
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-0.5 top-0.5 rounded-full bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500 shadow-[0_0_14px_rgba(250,204,21,0.55)] transition-transform duration-300 ease-out ${
          isHandcraft ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{ left: '0.125rem', width: 'calc((100% - 0.25rem) / 2)' }}
      />
      <Link
        href="/"
        className={`relative z-10 flex items-center justify-center rounded-full px-2.5 transition-colors ${
          !isHandcraft ? 'text-black' : 'text-amber-100/80 hover:text-amber-100'
        }`}
      >
        工作流
      </Link>
      <Link
        href="/handcraft"
        className={`relative z-10 flex items-center justify-center rounded-full px-2.5 transition-colors ${
          isHandcraft ? 'text-black' : 'text-amber-100/80 hover:text-amber-100'
        }`}
      >
        手搓党
      </Link>
    </nav>
  );
}
