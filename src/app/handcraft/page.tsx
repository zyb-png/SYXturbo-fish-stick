import { CreationPointsWallet } from '@/components/creation-points-wallet';
import { WorkspaceModeSwitch } from '@/components/workspace-mode-switch';

export default function HandcraftPage() {
  return (
    <main className="black-mirror-shell min-h-screen overflow-hidden px-3 py-3 sm:px-5">
      <div className="black-mirror-lines" aria-hidden="true">
        <span className="mirror-line mirror-line-one" />
        <span className="mirror-line mirror-line-two" />
        <span className="mirror-line mirror-line-three" />
        <span className="mirror-line mirror-line-four" />
      </div>

      <div className="black-mirror-content relative z-10 mx-auto flex h-[calc(100vh-1.5rem)] max-w-[1920px] flex-col">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-left">
            <div className="black-mirror-brand">
              <span className="brand-star brand-star-left" aria-hidden="true">✦</span>
              <h1 className="black-mirror-title font-serif text-2xl font-semibold sm:text-3xl">
                MM钰汐
              </h1>
              <span className="brand-star brand-star-right" aria-hidden="true">✧</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <WorkspaceModeSwitch active="handcraft" />
            <CreationPointsWallet />
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-hidden rounded-md border border-amber-300/25 bg-black/35 shadow-[0_0_40px_rgba(245,158,11,0.12)]">
          <iframe
            src="/handcraft-static/index.html"
            title="手搓党视频生成"
            className="h-full w-full border-0"
          />
        </section>
      </div>
    </main>
  );
}
