<script setup lang="ts">
// The project's timeline as one line: Contentia is the trunk that starts in 2016, sleeps after 2018
// (dashed), comes back, and in October 2026 Laika CMS branches off it as the layer on top.
// Below ~560px wide it runs top to bottom.
import { onBeforeUnmount, onMounted, ref } from 'vue';

const milestones = [
  { when: '2016', what: 'schema-to-form generator' },
  { when: '2018', what: 'almost released' },
  { when: 'revived', what: 'rebuilt with Claude' },
  { when: 'Oct 2026', what: 'the split' },
];

const root = ref<HTMLElement>();
const narrow = ref(false);
let observer: ResizeObserver | undefined;

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    narrow.value = entry!.contentRect.width < 560;
  });
  observer.observe(root.value!);
});
onBeforeUnmount(() => observer?.disconnect());

const label =
  'Timeline: started in 2016, almost released in 2018, dormant, revived with Claude, and split in October 2026 into Contentia and Laika CMS on top of it.';

// Wide geometry
const Y = 132;
const X = [92, 272, 452, 612];
// Narrow geometry
const NX = 36;
const NY = [40, 140, 240, 340];
</script>

<template>
  <div ref="root" class="timeline">
    <svg v-if="!narrow" viewBox="0 0 900 220" role="img" :aria-label="label">
      <path class="trunk" :d="`M${X[0]} ${Y} H${X[1]}`" />
      <path class="flow" :d="`M${X[0]} ${Y} H${X[1]}`" />
      <path class="trunk dormant" :d="`M${X[1]} ${Y} H${X[2]}`" />
      <path class="trunk" :d="`M${X[2]} ${Y} H780`" />
      <path class="flow" :d="`M${X[2]} ${Y} H780`" />
      <path class="trunk" :d="`M${X[3]} ${Y} C${X[3] + 70} ${Y} ${X[3] + 60} 64 ${X[3] + 130} 64 H780`" />
      <path class="flow" :d="`M${X[3]} ${Y} C${X[3] + 70} ${Y} ${X[3] + 60} 64 ${X[3] + 130} 64 H780`" />

      <g v-for="(m, i) in milestones" :key="m.when">
        <circle class="dot" :class="{ last: i === milestones.length - 1 }" :cx="X[i]" :cy="Y" r="7" />
        <text class="when" :x="X[i]" :y="Y - 22" text-anchor="middle">{{ m.when }}</text>
        <text class="what" :x="X[i]" :y="Y + 32" text-anchor="middle">{{ m.what }}</text>
      </g>
      <text class="dormant-label" :x="(X[1] + X[2]) / 2" :y="Y - 10" text-anchor="middle">dormant</text>

      <text class="end" x="792" :y="Y + 5">Contentia</text>
      <text class="end-sub" x="792" :y="Y + 23">the content API</text>
      <text class="end" x="792" y="69">Laika CMS</text>
      <text class="end-sub" x="792" y="87">the CMS on top</text>
    </svg>
    <svg v-else viewBox="0 0 360 500" role="img" :aria-label="label">
      <path class="trunk" :d="`M${NX} ${NY[0]} V${NY[1]}`" />
      <path class="flow" :d="`M${NX} ${NY[0]} V${NY[1]}`" />
      <path class="trunk dormant" :d="`M${NX} ${NY[1]} V${NY[2]}`" />
      <path class="trunk" :d="`M${NX} ${NY[2]} V470`" />
      <path class="flow" :d="`M${NX} ${NY[2]} V470`" />
      <path class="trunk" :d="`M${NX} ${NY[3]} C${NX} ${NY[3] + 50} 150 ${NY[3] + 40} 150 ${NY[3] + 90} V470`" />
      <path class="flow" :d="`M${NX} ${NY[3]} C${NX} ${NY[3] + 50} 150 ${NY[3] + 40} 150 ${NY[3] + 90} V470`" />

      <g v-for="(m, i) in milestones" :key="m.when">
        <circle class="dot" :class="{ last: i === milestones.length - 1 }" :cx="NX" :cy="NY[i]" r="7" />
        <text class="when" :x="NX + 22" :y="NY[i] + 1">{{ m.when }}</text>
        <text class="what" :x="NX + 22" :y="NY[i] + 21">{{ m.what }}</text>
      </g>
      <text class="dormant-label" :x="NX + 22" :y="(NY[1] + NY[2]) / 2 + 4">dormant</text>

      <text class="end" :x="NX" y="492" text-anchor="middle">Contentia</text>
      <text class="end" x="150" y="492" text-anchor="middle">Laika CMS</text>
    </svg>
  </div>
</template>

<style scoped>
.timeline {
  margin: 28px 0 8px;
}

svg {
  display: block;
  width: 100%;
  max-width: 900px;
  height: auto;
  overflow: visible;
  font-family: var(--vp-font-family-base);
}

.trunk {
  fill: none;
  stroke: var(--vp-c-border);
  stroke-width: 2;
}

.trunk.dormant {
  stroke-dasharray: 3 7;
}

.flow {
  fill: none;
  stroke: var(--vp-c-text-1);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-dasharray: 2 16;
  animation: flow 1.6s linear infinite;
}

@keyframes flow {
  to {
    stroke-dashoffset: -18;
  }
}

.dot {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-text-1);
  stroke-width: 2;
}

.dot.last {
  fill: var(--vp-c-text-1);
  transform-box: fill-box;
  transform-origin: center;
  animation: pulse 2.4s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    transform: scale(1.35);
  }
}

.when {
  fill: var(--vp-c-text-1);
  font: 600 15px var(--vp-font-family-mono);
}

.what,
.end-sub {
  fill: var(--vp-c-text-2);
  font-size: 14px;
}

.dormant-label {
  fill: var(--vp-c-text-3);
  font: 12px var(--vp-font-family-mono);
}

.end {
  fill: var(--vp-c-text-1);
  font-size: 15px;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .flow {
    display: none;
  }

  .dot.last {
    animation: none;
  }
}
</style>
