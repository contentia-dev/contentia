/**
 * The CMS-adapter seam: what the CLI needs to know about an admin UI whose
 * collection config it can turn into types (`contentia local generate`), so
 * that "which CMS" is a value in a registry rather than a hardcoded package
 * name. Decap is the only adapter today (see `./decap.ts`).
 *
 * Note the vocabulary clash with `../drivers/types.ts`: a *storage* driver
 * decides where Contentia keeps content, while a CMS adapter describes the
 * admin UI that edits it. They are separate axes.
 */

/** Where a config file was found, and everything that was checked getting there. */
export interface CmsConfigDiscovery {
  /** Absolute path of the first match, or `''` when nothing was found. */
  readonly resolved: string;
  /** Every absolute path that was checked, so callers can list them in an error. */
  readonly searched: ReadonlyArray<string>;
}

/**
 * A CMS whose collection config lives in a file that `contentia local generate`
 * can turn into a typed TypeScript module. Adapters whose config is authored
 * in TypeScript to begin with leave `CmsAdapter.config` undefined.
 */
export interface CmsConfigCodegen {
  /** Look for the config file, starting at `cwd`. */
  discover(cwd: string): Promise<CmsConfigDiscovery>;
  /** Where generated output goes when `--output` is omitted, given a resolved input path. */
  defaultOutput(input: string): string;
  /** Read `input`, write the typed module to `output`, and report the absolute paths used. */
  generate(args: { readonly input: string, readonly output: string }): Promise<
    { readonly input: string, readonly output: string }
  >;
}

/** One admin UI the CLI knows how to generate config types for. */
export interface CmsAdapter {
  /** Short identifier used in `--cms`. e.g. 'decap'. */
  readonly name: string;
  /** Display name. e.g. 'Decap CMS'. */
  readonly title: string;
  /** One-line description shown next to the choice. */
  readonly description: string;
  /** Typed-config codegen, when this CMS keeps its collections in a config file. */
  readonly config?: CmsConfigCodegen;
}
