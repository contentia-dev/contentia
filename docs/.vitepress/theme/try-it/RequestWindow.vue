<script setup lang="ts">
/**
 * The request window an endpoint's Try it button opens, laid out like the API clients in other
 * OpenAPI references (Scalar's, Mintlify's): an address bar with Send, the request's parameters,
 * headers and body on the left, and the response on the right. Requests go to the reference's
 * example server, which `api-sandbox.ts` answers in the browser.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue';

import { resetSandbox } from '../api-sandbox';
import {
  buildUrl,
  deref,
  findOperation,
  formatBytes,
  highlightJson,
  inlineCode,
  isJson,
  type Param,
  type Spec,
  STATUS_TEXT,
  toCurl,
} from './request-model';

const props = defineProps<{ spec: Spec; operationId: string }>();
const open = defineModel<boolean>('open', { required: true });

const uid = useId();
const operation = findOperation(props.spec, props.operationId)!;
const method = operation.method.toUpperCase();
const mac = /Mac|iPhone|iPad/.test(navigator.platform);

// --- Request ------------------------------------------------------------------------------------

const keyOf = (param: Param) => `${param.in}:${param.name}`;
const inputId = (param: Param) => `${uid}-${param.in}-${param.name}`;
const values = reactive<Record<string, string>>(
  Object.fromEntries(operation.params.map(param => [keyOf(param), param.initial])),
);

const paramsIn = (location: Param['in']) => operation.params.filter(param => param.in === location);
const groups = [
  { title: 'Path parameters', params: paramsIn('path') },
  { title: 'Query parameters', params: paramsIn('query') },
].filter(group => group.params.length);
const headerParams = paramsIn('header');

function typeOf(param: Param): string {
  const { type, format } = param.schema;
  const name = Array.isArray(type) ? type.filter(t => t !== 'null').join(' | ') : String(type ?? 'string');
  return format ? `${name}<${String(format)}>` : name;
}

/** The choices a select offers for `param`, or undefined when it takes free text. */
function choicesFor(param: Param): readonly string[] | undefined {
  if (Array.isArray(param.schema.enum)) return param.schema.enum.map(String);
  if (param.schema.type === 'boolean') return ['true', 'false'];
  return undefined;
}

const isNumeric = (param: Param) => param.schema.type === 'integer' || param.schema.type === 'number';

const placeholderFor = (param: Param) =>
  String(param.schema.example ?? param.schema.default ?? (param.required ? 'required' : ''));

const accept = ref('application/vnd.api+json');

const bodyTypes = operation.bodyTypes;
const bodyType = ref(bodyTypes.find(type => isJson(type.mediaType))?.mediaType ?? bodyTypes[0]?.mediaType ?? '');
const bodyText = ref(operation.initialBody);
const isJsonBody = computed(() => isJson(bodyType.value));
const isMultipart = computed(() => bodyType.value === 'multipart/form-data');

/** A multipart body's fields: the schema's properties, a binary one taking a file. */
const formFields = computed(() => {
  const schema = deref(props.spec, bodyTypes.find(type => type.mediaType === bodyType.value)?.schema);
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(properties).map(([name, property]) => {
    const field = deref(props.spec, property);
    return {
      name,
      file: field.format === 'binary' || 'contentMediaType' in field,
      required: required.includes(name),
      description: String(field.description ?? ''),
    };
  });
});
const formValues = reactive<Record<string, string | File | undefined>>({});

function onFile(name: string, event: Event) {
  formValues[name] = (event.target as HTMLInputElement).files?.[0];
}

const url = computed(() => buildUrl(operation, values));

/** The URL as the address bar shows it: server muted, filled path parameters marked, empty ones flagged. */
const urlParts = computed(() => {
  const parts: { text: string; kind: string }[] = [{ text: operation.server, kind: 'server' }];
  for (const piece of operation.path.split(/(\{[^}]+\})/)) {
    if (!piece) continue;
    const name = /^\{(.+)\}$/.exec(piece)?.[1];
    const value = name && values[`path:${name}`];
    if (!name) parts.push({ text: piece, kind: 'path' });
    else if (value) parts.push({ text: encodeURIComponent(value), kind: 'param' });
    else parts.push({ text: piece, kind: 'param-empty' });
  }
  const query = url.value.split('?')[1];
  if (query) parts.push({ text: `?${query}`, kind: 'query' });
  return parts;
});

const requestHeaders = computed(() => {
  const headers: [string, string][] = [];
  if (accept.value) headers.push(['Accept', accept.value]);
  if (bodyTypes.length && !isMultipart.value && bodyText.value.trim()) headers.push(['Content-Type', bodyType.value]);
  for (const param of headerParams) {
    const value = values[keyOf(param)];
    if (value) headers.push([param.name, value]);
  }
  return headers;
});

const curl = computed(() =>
  toCurl({
    method,
    url: url.value,
    headers: requestHeaders.value,
    body: bodyTypes.length && !isMultipart.value ? bodyText.value.trim() : undefined,
    form: isMultipart.value
      ? formFields.value.flatMap(field => {
        const value = formValues[field.name];
        if (!value) return [];
        return [[field.name, typeof value === 'string' ? value : value.name, typeof value !== 'string'] as const];
      })
      : undefined,
  })
);

function formatBody() {
  try {
    bodyText.value = JSON.stringify(JSON.parse(bodyText.value), null, 2);
  } catch {
    problem.value = "The body isn't valid JSON, so it can't be formatted.";
  }
}

/** Tab indents in the body editor instead of leaving it. */
function indent(event: KeyboardEvent) {
  const editor = event.target as HTMLTextAreaElement;
  const { selectionStart: start, selectionEnd: end } = editor;
  bodyText.value = `${bodyText.value.slice(0, start)}  ${bodyText.value.slice(end)}`;
  void nextTick(() => editor.setSelectionRange(start + 2, start + 2));
}

// --- Sending --------------------------------------------------------------------------------------

interface Result {
  readonly status: number;
  readonly ms: number;
  readonly bytes: number;
  readonly contentType: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly html?: string;
  readonly text?: string;
  readonly imageUrl?: string;
}

const sending = ref(false);
const problem = ref('');
const result = ref<Result>();

function requestBody(): BodyInit | undefined {
  if (!bodyTypes.length) return undefined;
  if (isMultipart.value) {
    const form = new FormData();
    for (const field of formFields.value) {
      const value = formValues[field.name];
      if (value) form.append(field.name, value);
    }
    return form;
  }
  const text = bodyText.value.trim();
  if (text && isJsonBody.value) JSON.parse(text);
  return text || undefined;
}

async function send() {
  if (sending.value) return;
  problem.value = '';
  const missing = paramsIn('path').filter(param => !values[keyOf(param)]);
  if (missing.length) {
    problem.value = `Fill in ${missing.map(param => param.name).join(' and ')} first.`;
    document.getElementById(inputId(missing[0]!))?.focus();
    return;
  }
  let body: BodyInit | undefined;
  try {
    body = requestBody();
  } catch (error) {
    problem.value = `The body isn't valid JSON: ${(error as Error).message}`;
    return;
  }
  sending.value = true;
  const started = performance.now();
  try {
    const response = await fetch(url.value, { method, headers: requestHeaders.value, body });
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? '';
    const text = () => new TextDecoder().decode(buffer);
    let content: Pick<Result, 'html' | 'text' | 'imageUrl'> = {};
    if (!buffer.byteLength) content = {};
    else if (/json/i.test(contentType)) {
      try {
        content = { html: highlightJson(JSON.stringify(JSON.parse(text()), null, 2)) };
      } catch {
        content = { text: text() };
      }
    } else if (/^text\/|xml|yaml/i.test(contentType)) content = { text: text() };
    else if (/^image\//i.test(contentType)) {
      content = { imageUrl: URL.createObjectURL(new Blob([buffer], { type: contentType })) };
    }
    releaseImage();
    result.value = {
      status: response.status,
      ms: performance.now() - started,
      bytes: buffer.byteLength,
      contentType,
      headers: [...response.headers],
      ...content,
    };
  } catch (error) {
    problem.value = `The request failed: ${(error as Error).message}`;
  } finally {
    sending.value = false;
  }
}

function releaseImage() {
  if (result.value?.imageUrl) URL.revokeObjectURL(result.value.imageUrl);
}

const statusClass = computed(() => `rw-status--${String(result.value?.status ?? 0).charAt(0)}xx`);

// --- Window ---------------------------------------------------------------------------------------

const dialog = ref<HTMLDialogElement>();
const sendButton = ref<HTMLButtonElement>();

function show() {
  if (!dialog.value || dialog.value.open) return;
  dialog.value.showModal();
  document.documentElement.classList.add('rw-scroll-lock');
  sendButton.value?.focus();
}

function onClose() {
  open.value = false;
  document.documentElement.classList.remove('rw-scroll-lock');
}

/** A click on the dialog element itself, not its content, is a click on the backdrop. */
function onDialogClick(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value.close();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void send();
  }
}

watch(open, value => (value ? show() : dialog.value?.close()));
onMounted(() => open.value && show());
onBeforeUnmount(() => {
  releaseImage();
  document.documentElement.classList.remove('rw-scroll-lock');
});

const copied = ref('');
async function copy(what: string, text: string) {
  await navigator.clipboard.writeText(text);
  copied.value = what;
  setTimeout(() => copied.value === what && (copied.value = ''), 1500);
}

const responseText = () => {
  const html = result.value?.html;
  if (!html) return result.value?.text ?? '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
};

const cleared = ref(false);
function clearSandbox() {
  resetSandbox();
  result.value = undefined;
  cleared.value = true;
  setTimeout(() => (cleared.value = false), 1500);
}
</script>

<template>
  <dialog
    ref="dialog"
    class="RequestWindow"
    :aria-labelledby="`${uid}-title`"
    @close="onClose"
    @click="onDialogClick"
    @keydown="onKeydown"
  >
    <form class="rw" novalidate @submit.prevent="send">
      <header class="rw-bar">
        <span :class="['rw-method', 'OAMethodBadge', `OAMethodBadge--${operation.method}`]">{{ method }}</span>
        <div class="rw-url" :title="url">
          <span v-for="(part, i) in urlParts" :key="i" :class="`rw-url-${part.kind}`">{{ part.text }}</span>
        </div>
        <button ref="sendButton" type="submit" class="rw-send" :disabled="sending">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>
          {{ sending ? 'Sending' : 'Send' }}
        </button>
        <button type="button" class="rw-icon-button" aria-label="Close" @click="open = false">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="rw-main">
        <section class="rw-pane rw-request" aria-label="Request">
          <div :id="`${uid}-title`" class="rw-title">{{ operation.summary }}</div>
          <p v-if="problem" class="rw-problem" role="alert">{{ problem }}</p>

          <details v-for="group in groups" :key="group.title" class="rw-section" open>
            <summary>
              {{ group.title }} <span class="rw-count">{{ group.params.length }}</span>
            </summary>
            <div v-for="param in group.params" :key="param.name" class="rw-row">
              <div class="rw-row-info">
                <label class="rw-row-label" :for="inputId(param)">
                  <code class="rw-name">{{ param.name }}</code>
                  <span class="rw-type">{{ typeOf(param) }}</span>
                  <span v-if="param.required" class="rw-required">required</span>
                </label>
                <!-- inlineCode escapes the description. -->
                <p v-if="param.description" class="rw-desc" v-html="inlineCode(param.description)" />
              </div>
              <select
                v-if="choicesFor(param)"
                :id="inputId(param)"
                v-model="values[keyOf(param)]"
                class="rw-input"
              >
                <option value="">Not set</option>
                <option v-for="choice in choicesFor(param)" :key="choice" :value="choice">{{ choice }}</option>
              </select>
              <input
                v-else
                :id="inputId(param)"
                v-model="values[keyOf(param)]"
                class="rw-input"
                :type="isNumeric(param) ? 'number' : 'text'"
                :min="isNumeric(param) ? (param.schema.minimum as number | undefined) : undefined"
                :placeholder="placeholderFor(param)"
                autocomplete="off"
                spellcheck="false"
              >
            </div>
          </details>

          <details class="rw-section">
            <summary>Headers <span class="rw-count">{{ requestHeaders.length }}</span></summary>
            <div class="rw-row">
              <label class="rw-row-label" :for="`${uid}-accept`"><code class="rw-name">Accept</code></label>
              <input :id="`${uid}-accept`" v-model="accept" class="rw-input" spellcheck="false">
            </div>
            <div v-if="bodyTypes.length" class="rw-row">
              <span class="rw-row-label"><code class="rw-name">Content-Type</code></span>
              <span class="rw-fixed">{{ isMultipart ? 'multipart/form-data; boundary=…' : bodyType }}</span>
            </div>
            <div v-for="param in headerParams" :key="param.name" class="rw-row">
              <label class="rw-row-label" :for="inputId(param)"><code class="rw-name">{{ param.name }}</code></label>
              <input :id="inputId(param)" v-model="values[keyOf(param)]" class="rw-input" spellcheck="false">
            </div>
          </details>

          <details v-if="bodyTypes.length" class="rw-section" open>
            <summary>Body</summary>
            <div class="rw-toolbar">
              <select v-if="bodyTypes.length > 1" v-model="bodyType" class="rw-input rw-input--small" aria-label="Media type">
                <option v-for="type in bodyTypes" :key="type.mediaType" :value="type.mediaType">
                  {{ type.mediaType }}
                </option>
              </select>
              <span v-else class="rw-media-type">{{ bodyType }}</span>
              <span class="rw-spacer" />
              <template v-if="!isMultipart">
                <button type="button" class="rw-text-button" @click="formatBody">Format</button>
                <button type="button" class="rw-text-button" @click="bodyText = operation.initialBody">Reset</button>
              </template>
            </div>
            <template v-if="isMultipart">
              <div v-for="field in formFields" :key="field.name" class="rw-row">
                <div class="rw-row-info">
                  <label class="rw-row-label" :for="`${uid}-form-${field.name}`">
                    <code class="rw-name">{{ field.name }}</code>
                    <span class="rw-type">{{ field.file ? 'file' : 'string' }}</span>
                    <span v-if="field.required" class="rw-required">required</span>
                  </label>
                  <!-- inlineCode escapes the description. -->
                  <p v-if="field.description" class="rw-desc" v-html="inlineCode(field.description)" />
                </div>
                <input
                  v-if="field.file"
                  :id="`${uid}-form-${field.name}`"
                  class="rw-input rw-input--file"
                  type="file"
                  @change="onFile(field.name, $event)"
                >
                <input
                  v-else
                  :id="`${uid}-form-${field.name}`"
                  v-model="formValues[field.name]"
                  class="rw-input"
                  spellcheck="false"
                >
              </div>
            </template>
            <textarea
              v-else
              v-model="bodyText"
              class="rw-editor"
              aria-label="Request body"
              spellcheck="false"
              autocomplete="off"
              :rows="Math.min(24, Math.max(8, bodyText.split('\n').length + 1))"
              @keydown.tab.exact.prevent="indent"
            />
          </details>

          <details class="rw-section">
            <summary>cURL</summary>
            <div class="rw-code">
              <button type="button" class="rw-text-button rw-copy" @click="copy('curl', curl)">
                {{ copied === 'curl' ? 'Copied' : 'Copy' }}
              </button>
              <pre>{{ curl }}</pre>
            </div>
          </details>
        </section>

        <section class="rw-pane rw-response" aria-label="Response" aria-live="polite">
          <div class="rw-response-head">
            <span class="rw-title rw-title--inline">Response</span>
            <template v-if="result">
              <span :class="['rw-status', statusClass]">
                {{ result.status }} {{ STATUS_TEXT[result.status] ?? '' }}
              </span>
              <span class="rw-meta">{{ Math.max(1, Math.round(result.ms)) }} ms</span>
              <span class="rw-meta">{{ formatBytes(result.bytes) }}</span>
            </template>
          </div>

          <div v-if="!result" class="rw-empty">
            <p>Send the request to see its response here.</p>
            <p class="rw-shortcut"><kbd>{{ mac ? '⌘' : 'Ctrl' }}</kbd><kbd>↵</kbd></p>
          </div>

          <template v-else>
            <details class="rw-section">
              <summary>Headers <span class="rw-count">{{ result.headers.length }}</span></summary>
              <dl class="rw-headers">
                <template v-for="[name, value] in result.headers" :key="name">
                  <dt>{{ name }}</dt>
                  <dd>{{ value }}</dd>
                </template>
              </dl>
            </details>
            <div class="rw-toolbar rw-toolbar--body">
              <span class="rw-media-type">{{ result.contentType || 'No body' }}</span>
              <span class="rw-spacer" />
              <button
                v-if="result.html || result.text"
                type="button"
                class="rw-text-button"
                @click="copy('response', responseText())"
              >
                {{ copied === 'response' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <!-- highlightJson escapes the response text. -->
            <pre v-if="result.html" class="rw-json" v-html="result.html" />
            <pre v-else-if="result.text" class="rw-json">{{ result.text }}</pre>
            <img v-else-if="result.imageUrl" class="rw-image" :src="result.imageUrl" alt="Response image">
            <p v-else class="rw-note">{{ result.bytes ? `${formatBytes(result.bytes)} of binary data.` : 'No content.' }}</p>
          </template>
        </section>
      </div>

      <footer class="rw-foot">
        <p>
          Runs in your browser: Contentia answers from <code>sessionStorage</code>, and nothing leaves this tab.
        </p>
        <button type="button" class="rw-text-button" @click="clearSandbox">
          {{ cleared ? 'Sandbox cleared' : 'Reset sandbox' }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style>
html.rw-scroll-lock {
  overflow: hidden;
}
</style>

<style scoped>
.RequestWindow {
  --rw-border: var(--vp-c-divider);
  --rw-muted: var(--vp-c-text-2);
  --rw-faint: var(--vp-c-text-3);
  /* GitHub's syntax colors. */
  --tok-key: #116329;
  --tok-string: #0a3069;
  --tok-number: #0550ae;
  --tok-literal: #cf222e;

  width: min(1200px, calc(100vw - 64px));
  height: min(860px, calc(100dvh - 64px));
  max-width: none;
  max-height: none;
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
}

.dark .RequestWindow {
  --tok-key: #7ee787;
  --tok-string: #a5d6ff;
  --tok-number: #79c0ff;
  --tok-literal: #ff7b72;
}

.RequestWindow::backdrop {
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(2px);
}

.rw {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  /* Without it the column grows to the address bar's unwrapped URL. */
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
}

/* Address bar */

.rw-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--rw-border);
}

.rw-method {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
}

.rw-url {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  padding: 6px 10px;
  border: 1px solid var(--rw-border);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  white-space: nowrap;
  scrollbar-width: none;
}

.rw-url-server,
.rw-url-query {
  color: var(--rw-muted);
}

.rw-url-path {
  font-weight: 600;
}

.rw-url-param {
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  font-weight: 600;
}

.rw-url-param-empty {
  padding: 0 3px;
  border: 1px dashed var(--vp-c-yellow-1);
  border-radius: 4px;
  color: var(--vp-c-yellow-1);
}

.rw-send {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px 0 12px;
  border-radius: 8px;
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
  font-weight: 600;
}

.rw-send:hover:not(:disabled) {
  background: var(--vp-button-brand-hover-bg);
}

.rw-send:disabled {
  opacity: 0.6;
}

.rw-send svg {
  width: 12px;
  height: 12px;
}

.rw-icon-button {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--rw-muted);
}

.rw-icon-button:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.rw-icon-button svg {
  width: 16px;
  height: 16px;
}

.rw-send:focus-visible,
.rw-icon-button:focus-visible,
.rw-text-button:focus-visible {
  outline: 2px solid var(--vp-c-text-1);
  outline-offset: 2px;
}

/* Panes */

.rw-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-height: 0;
}

.rw-pane {
  min-height: 0;
  overflow-y: auto;
}

.rw-request {
  border-right: 1px solid var(--rw-border);
}

.rw-title {
  padding: 14px 16px 10px;
  font-size: 14px;
  font-weight: 600;
}

.rw-title--inline {
  padding: 0;
}

.rw-problem {
  margin: 0 16px 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
  line-height: 1.5;
}

/* Collapsible sections */

.rw-section {
  border-top: 1px solid var(--rw-border);
}

.rw-section > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 9px 16px;
  background: var(--vp-c-bg-soft);
  font-weight: 600;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.rw-section > summary::-webkit-details-marker {
  display: none;
}

.rw-section > summary::before {
  content: '';
  width: 6px;
  height: 6px;
  margin: 0 4px 0 2px;
  border-right: 1.5px solid var(--rw-muted);
  border-bottom: 1.5px solid var(--rw-muted);
  transform: rotate(-45deg);
  transition: transform 0.15s;
}

.rw-section[open] > summary::before {
  transform: rotate(45deg);
}

.rw-section[open] > summary {
  border-bottom: 1px solid var(--rw-border);
}

.rw-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--vp-c-default-soft);
  color: var(--rw-muted);
  font-size: 11px;
  font-weight: 500;
  text-align: center;
}

/* Parameter rows */

.rw-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: start;
  gap: 4px 16px;
  padding: 10px 16px;
}

.rw-row + .rw-row {
  border-top: 1px solid var(--rw-border);
}

.rw-row-label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-height: 32px;
  padding-top: 6px;
}

.rw-name {
  padding: 0;
  background: none;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
}

.rw-type {
  color: var(--rw-muted);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.rw-required {
  color: var(--vp-c-danger-1);
  font-size: 12px;
}

.rw-desc {
  margin: 0;
  color: var(--rw-muted);
  font-size: 12px;
  line-height: 1.5;
}

.rw-desc :deep(code) {
  padding: 0 3px;
  border-radius: 3px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
}

.rw-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-border);
  border-radius: 7px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}

.rw-input:focus,
.rw-editor:focus {
  border-color: var(--vp-c-text-2);
  outline: none;
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}

.rw-input--small {
  width: auto;
  height: 28px;
}

.rw-input--file {
  padding: 3px 4px;
  color: var(--rw-muted);
  font-family: inherit;
  font-size: 12px;
}

.rw-input--file::file-selector-button {
  height: 24px;
  margin-right: 8px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-border);
  border-radius: 5px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}

.rw-fixed {
  align-self: center;
  color: var(--rw-muted);
  font-family: var(--vp-font-family-mono);
}

/* Body */

.rw-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
}

.rw-toolbar--body {
  border-top: 1px solid var(--rw-border);
}

.rw-media-type {
  color: var(--rw-muted);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.rw-spacer {
  flex: 1;
}

.rw-text-button {
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--rw-muted);
  font-size: 12px;
  font-weight: 500;
}

.rw-text-button:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}

.rw-editor {
  display: block;
  width: calc(100% - 32px);
  margin: 0 16px 16px;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
  resize: vertical;
}

.rw-code {
  position: relative;
  margin: 12px 16px 16px;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
}

.rw-copy {
  position: absolute;
  top: 6px;
  right: 6px;
}

.rw-code pre,
.rw-json {
  margin: 0;
  overflow-x: auto;
  padding: 12px 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}

/* Response */

.rw-response {
  display: flex;
  flex-direction: column;
}

.rw-response-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-height: 47px;
  padding: 10px 16px;
}

.rw-status {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
}

.rw-status--2xx {
  background: var(--vp-c-success-soft);
  color: var(--vp-c-success-1);
}

.rw-status--3xx {
  background: var(--vp-c-tip-soft);
  color: var(--vp-c-tip-1);
}

.rw-status--4xx {
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-warning-1);
}

.rw-status--5xx {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}

.rw-meta {
  color: var(--rw-muted);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.rw-empty {
  display: grid;
  flex: 1;
  place-content: center;
  gap: 10px;
  border-top: 1px solid var(--rw-border);
  color: var(--rw-faint);
  text-align: center;
}

.rw-empty p {
  margin: 0;
}

.rw-shortcut {
  display: flex;
  justify-content: center;
  gap: 4px;
}

kbd {
  min-width: 24px;
  padding: 2px 6px;
  border: 1px solid var(--vp-c-border);
  border-radius: 5px;
  background: var(--vp-c-bg-soft);
  color: var(--rw-muted);
  font-family: var(--vp-font-family-base);
  font-size: 13px;
  line-height: 1.4;
}

.rw-headers {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 16px;
  margin: 0;
  padding: 10px 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.rw-headers dt {
  color: var(--rw-muted);
}

.rw-headers dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.rw-json {
  flex: 1;
  border-top: 1px solid var(--rw-border);
  background: var(--vp-code-block-bg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.rw-json :deep(.tok-key) {
  color: var(--tok-key);
}

.rw-json :deep(.tok-string) {
  color: var(--tok-string);
}

.rw-json :deep(.tok-number) {
  color: var(--tok-number);
}

.rw-json :deep(.tok-literal) {
  color: var(--tok-literal);
}

.rw-image {
  max-width: 100%;
  margin: 16px;
}

.rw-note {
  margin: 0;
  padding: 16px;
  color: var(--rw-muted);
}

/* Footer */

.rw-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 16px;
  border-top: 1px solid var(--rw-border);
  color: var(--rw-faint);
  font-size: 12px;
}

.rw-foot p {
  flex: 1;
  margin: 0;
  line-height: 1.5;
}

.rw-foot code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

@media (max-width: 767px) {
  .RequestWindow {
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .rw-main {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }

  .rw-pane {
    overflow: visible;
  }

  .rw-request {
    border-right: 0;
  }

  .rw-response {
    min-height: 50vh;
    border-top: 1px solid var(--rw-border);
  }

  .rw-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
