import type { ReactNode } from 'react'
import { GlassButton } from '@/components/ui/glasscn/glass-button'
import { GlassCard } from '@/components/ui/glasscn/glass-card'
import { WebGpuLiquidGlass } from '@/components/ui/webgpu-liquid-glass'
import { cn } from '@/lib/utils'
import { GlassSurface } from 'glass-lens-react'
import { LiquidGlass as SimpleLiquidGlass } from 'simple-liquid-glass'

function CompareBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-[#d1d1d6]">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            'linear-gradient(135deg, #007aff 0%, transparent 42%), linear-gradient(225deg, #5856d6 0%, transparent 38%), linear-gradient(45deg, #ff9500 0%, transparent 35%)',
        }}
      />
      <div className="absolute left-[8%] top-[18%] h-24 w-24 rounded-full bg-white/70 blur-sm" />
      <div className="absolute right-[10%] top-[52%] h-20 w-32 rounded-2xl bg-[#34c759]/50 rotate-12" />
      <div className="absolute bottom-[12%] left-[28%] h-16 w-16 rounded-full border-4 border-white/80" />
    </div>
  )
}

type ColumnProps = {
  title: string
  subtitle: string
  license: string
  children: ReactNode
}

function CompareColumn({ title, subtitle, license, children }: ColumnProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3">
      <header>
        <h2 className="m-0 text-sm font-semibold tracking-tight">{title}</h2>
        <p className="m-0 mt-1 text-xs text-muted-foreground">{subtitle}</p>
        <p className="m-0 mt-0.5 text-[11px] text-muted-foreground/80">{license}</p>
      </header>
      <div className="relative h-[220px] overflow-hidden rounded-2xl ring-1 ring-black/10">
        <CompareBackdrop />
        <div className="relative flex h-full flex-col justify-end gap-2.5 p-3.5">{children}</div>
      </div>
    </section>
  )
}

function RealisticRow() {
  return (
    <div className="mb-8 grid gap-4 md:grid-cols-2">
      <div>
        <h2 className="m-0 mb-2 text-sm font-semibold">Popup 灰底 · simple-liquid-glass</h2>
        <div className="w-[288px] overflow-hidden rounded-2xl bg-[#f2f2f7] ring-1 ring-black/10">
          <div className="flex flex-col gap-2.5 p-3.5">
            <p className="m-0 text-[15px] font-semibold tracking-tight">Tab Manager</p>
            <SimpleLiquidGlass
              radius={14}
              blur={2}
              frost={0.1}
              glassColor="rgba(255,255,255,0.45)"
              className="px-3 py-2.5 text-xs"
            >
              <p className="m-0 font-medium">最近：工作会话（12 个标签）</p>
            </SimpleLiquidGlass>
            <SimpleLiquidGlass
              radius={12}
              blur={1}
              glassColor="rgba(255,255,255,0.4)"
              className="w-full px-3 py-2 text-center text-sm font-medium"
            >
              收纳当前窗口
            </SimpleLiquidGlass>
          </div>
        </div>
      </div>

      <div>
        <h2 className="m-0 mb-2 text-sm font-semibold">Popup 灰底 · WebGPU（自研）</h2>
        <WebGpuLiquidGlass
          className="w-[288px] rounded-2xl ring-1 ring-black/10"
          contentClassName="flex flex-col gap-2.5 p-3.5"
          params={{ radius: 16, bezel: 16, thickness: 1.5, blur: 2.5, chroma: 1.25 }}
        >
          <p className="m-0 text-[15px] font-semibold tracking-tight">Tab Manager</p>
          <WebGpuLiquidGlass
            className="rounded-xl"
            contentClassName="px-3 py-2.5 text-xs"
            params={{ radius: 12, bezel: 10, thickness: 1.1, blur: 1.6, chroma: 0.9, tint: [1, 1, 1, 0.12] }}
          >
            <p className="m-0 font-medium">最近：工作会话（12 个标签）</p>
          </WebGpuLiquidGlass>
          <WebGpuLiquidGlass
            className="rounded-xl"
            contentClassName="px-3 py-2 text-center text-sm font-medium"
            params={{ radius: 12, bezel: 10, thickness: 1.2, blur: 1.8, chroma: 1.0, tint: [1, 1, 1, 0.1] }}
          >
            收纳当前窗口
          </WebGpuLiquidGlass>
        </WebGpuLiquidGlass>
      </div>
    </div>
  )
}

export function GlassCompareApp() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-6">
        <h1 className="m-0 text-xl font-semibold tracking-tight">玻璃效果对比沙箱</h1>
        <p className="m-0 mt-2 max-w-2xl text-sm text-muted-foreground">
          灰底实测决定方案；花背景仅作参考。
          <code className="text-xs"> http://localhost:5190/glass-compare.html</code>
        </p>
      </header>

      <RealisticRow />

      <div className="flex flex-col gap-6 lg:flex-row">
        <CompareColumn
          title="@glasscn（当前）"
          subtitle="CSS backdrop-filter + SVG 位移"
          license="MIT · 已集成"
        >
          <GlassCard glassVariant="frosted" className="gap-2 px-3 py-2.5 text-xs">
            <p className="m-0 font-medium">会话卡片示例</p>
            <p className="m-0 text-muted-foreground">工作 · 12 个标签</p>
          </GlassCard>
          <GlassButton glassVariant="frosted" className="w-full justify-center text-sm">
            收纳当前窗口
          </GlassButton>
        </CompareColumn>

        <CompareColumn
          title="simple-liquid-glass"
          subtitle="Chromium SVG 折射"
          license="MIT · ~10KB"
        >
          <SimpleLiquidGlass
            radius={14}
            blur={2}
            frost={0.08}
            glassColor="rgba(255,255,255,0.42)"
            className="px-3 py-2.5 text-xs"
          >
            <p className="m-0 font-medium">会话卡片示例</p>
            <p className="m-0 opacity-80">工作 · 12 个标签</p>
          </SimpleLiquidGlass>
          <SimpleLiquidGlass
            radius={12}
            blur={1}
            glassColor="rgba(255,255,255,0.38)"
            className="w-full px-3 py-2 text-center text-sm font-medium"
          >
            收纳当前窗口
          </SimpleLiquidGlass>
        </CompareColumn>

        <CompareColumn
          title="glass-lens-react"
          subtitle="SVG / canvas / WebGL"
          license="MIT"
        >
          <div className="glass-control relative overflow-hidden rounded-[14px]">
            <GlassSurface preset="portfolio" reveal />
            <div className="relative px-3 py-2.5 text-xs">
              <p className="m-0 font-medium text-[#1d1d1f]">会话卡片示例</p>
              <p className="m-0 text-[#6e6e73]">工作 · 12 个标签</p>
            </div>
          </div>
          <button
            type="button"
            className={cn(
              'glass-control relative w-full overflow-hidden rounded-xl border-0 bg-transparent',
              'px-3 py-2 text-sm font-medium text-[#1d1d1f] cursor-pointer',
            )}
          >
            <GlassSurface preset="hero" reveal />
            <span className="relative">收纳当前窗口</span>
          </button>
        </CompareColumn>

        <CompareColumn
          title="WebGPU（自研）"
          subtitle="程序背景 + SDF 折射 / 色散 / 高光"
          license="项目内 · 有 CSS 回退"
        >
          <WebGpuLiquidGlass
            className="rounded-xl"
            contentClassName="px-3 py-2.5 text-xs"
            params={{ radius: 12, bezel: 11, thickness: 1.25, blur: 2, chroma: 1.1 }}
          >
            <p className="m-0 font-medium">会话卡片示例</p>
            <p className="m-0 opacity-80">工作 · 12 个标签</p>
          </WebGpuLiquidGlass>
          <WebGpuLiquidGlass
            className="rounded-xl"
            contentClassName="px-3 py-2 text-center text-sm font-medium"
            params={{ radius: 12, bezel: 10, thickness: 1.15, blur: 1.8, chroma: 1 }}
          >
            收纳当前窗口
          </WebGpuLiquidGlass>
        </CompareColumn>
      </div>
    </div>
  )
}
