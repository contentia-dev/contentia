#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import { Command } from 'effect/unstable/cli';

import packageJson from '../package.json' with { type: 'json' };
import {
  makeCreateCommand,
  makeGenerateCommand,
  makeListBackendsCommand,
  makeMigrateCommand,
  makeServeCommand,
} from './commands.js';

// Everything local-dev lives under the `local` namespace: `contentia local serve`,
// `contentia local generate`, … — leaving the top level free for future
// non-local commands (deploy, login, …). The package is `@contentia/cli` and
// its bin is `contentia`. `npx contentia` resolves to the core `contentia`
// package, whose `bin/contentia.mjs` shim delegates here (locally installed or
// fetched via `npm exec`).
const localCommand = Command.make('local').pipe(
  Command.withDescription(
    'Local-file dev tooling: storage server (`serve`), config codegen (`generate`), and repository migrations (`migrate`).',
  ),
  Command.withSubcommands([
    makeServeCommand('serve', 'contentia local'),
    makeGenerateCommand('generate', 'contentia local'),
    makeMigrateCommand('migrate', 'contentia local'),
    makeListBackendsCommand(),
  ]),
);

const command = Command.make('contentia').pipe(
  Command.withDescription('The Contentia CLI.'),
  Command.withSubcommands([makeCreateCommand(), localCommand]),
);

const program = Command.run(command, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
