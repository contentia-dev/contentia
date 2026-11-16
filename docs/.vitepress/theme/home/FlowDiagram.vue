<script setup lang="ts">
// An animated "who talks to whom" diagram: the things that use content on the left, Contentia in
// the middle, the storage on the right. Dashes flow along each link in the direction data moves.
// Ink-only (theme tokens), so it follows light and dark mode. Below ~560px wide it turns vertical:
// consumers on top, storage at the bottom, so the labels stay readable on a phone.
import { withBase } from 'vitepress';
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';

import { type IconName, icons } from './icons';
import './home.css';

export interface DiagramNode {
  label: string;
  sub?: string;
  /** A line icon, for things that use content. */
  icon?: IconName;
  /** An adapter key: shows /adapters/<key>.svg, for storage. */
  adapter?: string;
  /** A drop-in alternative: drawn faded with a dashed link and no traffic. */
  alt?: boolean;
}

const props = withDefaults(
  defineProps<{
    left: DiagramNode[],
    right: DiagramNode[],
    /** `read`: data only flows from storage to the consumers. */
    mode?: 'readwrite' | 'read',
    /** A dashed boundary, around Contentia alone or around everything. */
    zone?: { label: string, around: 'center' | 'all' },
    centerSub?: string,
    label: string,
  }>(),
  { mode: 'readwrite', centerSub: 'JSON:API' },
);

const uid = useId();
const root = ref<HTMLElement>();
const vertical = ref(false);
let observer: ResizeObserver | undefined;

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    vertical.value = entry!.contentRect.width < 560;
  });
  observer.observe(root.value!);
});
onBeforeUnmount(() => observer?.disconnect());

interface Placed extends DiagramNode {
  x: number;
  y: number;
  side: 'left' | 'right';
  path: string;
}

const R = 58; // Contentia's circle

const layout = computed(() => {
  const rows = Math.max(props.left.length, props.right.length, 1);
  if (!vertical.value) {
    const S = 76;
    const gap = 128;
    const W = 960;
    const H = Math.max(rows * gap + 48, 320);
    const cx = W / 2;
    const cy = H / 2 - 8;
    const place = (nodes: DiagramNode[], side: 'left' | 'right'): Placed[] =>
      nodes.map((n, i) => {
        const x = side === 'left' ? 150 : W - 150;
        const y = cy + (i - (nodes.length - 1) / 2) * gap;
        const x1 = side === 'left' ? x + S / 2 + 8 : x - S / 2 - 8;
        const x2 = side === 'left' ? cx - R - 10 : cx + R + 10;
        const y2 = cy + (y - cy) * 0.24;
        const mx = (x1 + x2) / 2;
        // Always drawn from the node towards Contentia.
        return { ...n, x, y, side, path: `M${x1} ${y} C${mx} ${y} ${mx} ${y2} ${x2} ${y2}` };
      });
    return {
      W,
      H,
      S,
      cx,
      cy,
      nodes: [...place(props.left, 'left'), ...place(props.right, 'right')],
      labelDy: S / 2 + 22,
      centerLabel: { x: cx, y: cy + R + 30, anchor: 'middle' as const },
      zoneRect: props.zone?.around === 'all'
        ? { x: 14, y: 14, w: W - 28, h: H - 28 }
        : { x: cx - 128, y: cy - 118, w: 256, h: 236 + 34 },
    };
  }
  const S = 58;
  const W = 400;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2;
  const place = (nodes: DiagramNode[], side: 'left' | 'right'): Placed[] => {
    const col = Math.min(104, (W - 48) / Math.max(nodes.length, 1));
    return nodes.map((n, i) => {
      const x = cx + (i - (nodes.length - 1) / 2) * col;
      const y = side === 'left' ? 86 : H - 120;
      const y1 = side === 'left' ? y + S / 2 + 44 : y - S / 2 - 8;
      const y2 = side === 'left' ? cy - R - 10 : cy + R + 10;
      const x2 = cx + (x - cx) * 0.24;
      const my = (y1 + y2) / 2;
      return { ...n, x, y, side, path: `M${x} ${y1} C${x} ${my} ${x2} ${my} ${x2} ${y2}` };
    });
  };
  return {
    W,
    H,
    S,
    cx,
    cy,
    nodes: [...place(props.left, 'left'), ...place(props.right, 'right')],
    labelDy: S / 2 + 18,
    centerLabel: { x: cx + R + 14, y: cy + 5, anchor: 'start' as const },
    zoneRect: props.zone?.around === 'all'
      ? { x: 10, y: 10, w: W - 20, h: H - 20 }
      : { x: cx - 112, y: cy - 96, w: 224, h: 192 },
  };
});

// Which way the dashes run on a link drawn node → Contentia.
function flows(n: Placed): ('in' | 'out')[] {
  if (n.alt) return [];
  if (props.mode === 'read') return [n.side === 'left' ? 'out' : 'in'];
  return ['in', 'out'];
}
</script>

<template>
  <div ref="root" class="flow-diagram">
    <svg
      :viewBox="`0 0 ${layout.W} ${layout.H}`"
      role="img"
      :aria-label="label"
      :class="{ vertical }"
    >
      <title>{{ label }}</title>
      <defs>
        <radialGradient :id="`${uid}-glow`">
          <stop offset="0" class="glow-stop" stop-opacity=".16" />
          <stop offset="1" class="glow-stop" stop-opacity="0" />
        </radialGradient>
      </defs>

      <g v-if="zone" class="zone">
        <rect
          :x="layout.zoneRect.x"
          :y="layout.zoneRect.y"
          :width="layout.zoneRect.w"
          :height="layout.zoneRect.h"
          rx="22"
        />
        <text :x="layout.zoneRect.x + 18" :y="layout.zoneRect.y + 26">{{ zone.label }}</text>
      </g>

      <g v-for="n in layout.nodes" :key="`${n.side}-${n.label}-link`" :class="{ alt: n.alt }">
        <path class="link" :d="n.path" />
        <path
          v-for="(dir, i) in flows(n)"
          :key="dir"
          class="flow"
          :class="dir"
          :d="n.path"
          :style="{ animationDelay: `${-i * 0.7 - (n.y % 5) * 0.11}s` }"
        />
      </g>

      <circle :cx="layout.cx" :cy="layout.cy" :r="R * 2.1" :fill="`url(#${uid}-glow)`" />
      <circle class="ring" :cx="layout.cx" :cy="layout.cy" :r="R + 14" />
      <circle class="core" :cx="layout.cx" :cy="layout.cy" :r="R" />
      <image
        class="mark ctia-light"
        :href="withBase('/contentia-mark.svg')"
        :x="layout.cx - R * 0.62"
        :y="layout.cy - R * 0.62"
        :width="R * 1.24"
        :height="R * 1.24"
      />
      <image
        class="mark ctia-dark"
        :href="withBase('/contentia-mark-dark.svg')"
        :x="layout.cx - R * 0.62"
        :y="layout.cy - R * 0.62"
        :width="R * 1.24"
        :height="R * 1.24"
      />
      <text
        class="center-label"
        :x="layout.centerLabel.x"
        :y="layout.centerLabel.y"
        :text-anchor="layout.centerLabel.anchor"
      >
        Contentia
      </text>
      <text
        class="sub"
        :x="layout.centerLabel.x"
        :y="layout.centerLabel.y + 17"
        :text-anchor="layout.centerLabel.anchor"
      >
        {{ centerSub }}
      </text>

      <g v-for="n in layout.nodes" :key="`${n.side}-${n.label}`" class="node" :class="{ alt: n.alt }">
        <rect
          :x="n.x - layout.S / 2"
          :y="n.y - layout.S / 2"
          :width="layout.S"
          :height="layout.S"
          :rx="layout.S * 0.26"
        />
        <template v-if="n.adapter">
          <image
            class="ctia-light"
            :href="withBase(`/adapters/${n.adapter}.svg`)"
            :x="n.x - layout.S * 0.27"
            :y="n.y - layout.S * 0.27"
            :width="layout.S * 0.54"
            :height="layout.S * 0.54"
          />
          <image
            class="ctia-dark"
            :href="withBase(`/adapters/${n.adapter}-dark.svg`)"
            :x="n.x - layout.S * 0.27"
            :y="n.y - layout.S * 0.27"
            :width="layout.S * 0.54"
            :height="layout.S * 0.54"
          />
        </template>
        <g
          v-else-if="n.icon"
          class="icon"
          :transform="`translate(${n.x - layout.S * 0.25} ${n.y - layout.S * 0.25}) scale(${layout.S * 0.5 / 24})`"
          v-html="icons[n.icon]"
        />
        <text class="label" :x="n.x" :y="n.y + layout.labelDy" text-anchor="middle">{{ n.label }}</text>
        <text v-if="n.sub" class="sub" :x="n.x" :y="n.y + layout.labelDy + 16" text-anchor="middle">
          {{ n.sub }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.flow-diagram {
  width: 100%;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: var(--vp-font-family-base);
}

.glow-stop {
  stop-color: var(--vp-c-text-1);
}

.zone rect {
  fill: none;
  stroke: var(--vp-c-border);
  stroke-width: 1.5;
  stroke-dasharray: 6 6;
}

.zone text {
  fill: var(--vp-c-text-3);
  font: 600 12px var(--vp-font-family-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.link {
  fill: none;
  stroke: var(--vp-c-border);
  stroke-width: 1.6;
}

.alt .link {
  stroke-dasharray: 4 6;
}

.flow {
  fill: none;
  stroke: var(--vp-c-text-1);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-dasharray: 2 16;
  animation: flow 1.6s linear infinite;
}

.flow.out {
  animation-direction: reverse;
}

@keyframes flow {
  to {
    stroke-dashoffset: -18;
  }
}

.ring {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.4;
  stroke-dasharray: 3 7;
  transform-box: fill-box;
  transform-origin: center;
  animation: spin 48s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.core {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-text-1);
  stroke-width: 1.5;
}

.node rect {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-divider);
  stroke-width: 1.5;
}

.node.alt {
  opacity: 0.5;
}

.icon {
  fill: none;
  stroke: var(--vp-c-text-1);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.label,
.center-label {
  fill: var(--vp-c-text-1);
  font-size: 15px;
  font-weight: 600;
}

.sub {
  fill: var(--vp-c-text-3);
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
}

.vertical .label,
.vertical .center-label {
  font-size: 13px;
}

.vertical .sub {
  font-size: 10.5px;
}

@media (prefers-reduced-motion: reduce) {
  .flow {
    display: none;
  }

  .ring {
    animation: none;
  }
}
</style>
