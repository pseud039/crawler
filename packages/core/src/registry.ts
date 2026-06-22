import { HttpFetcher } from './components/fetchers/http.fetcher.js';
import { HeadlessFetcher } from './components/fetchers/headless.fetcher.js';
import { ReadabilityParser } from './components/parsers/readability.js';
import { SemanticParser } from './components/parsers/semantic.parser.js';
import { BfsStrategy } from './components/strategies/bfs.strategies.js';
import { FocusedStrategy } from './components/strategies/focused.strategy.js';
import { StandardPoliteness } from './components/politeness/standard.politeness.js';
import { NoRevisit } from './components/revisit/no.revisit.js';

import type { FetcherComponent } from './interfaces/fetchers.interface.js';
import type { ParserComponent } from './interfaces/parsers.interface.js';
import type { StrategyComponent } from './interfaces/strategies.interface.js';
import type { PolitenessComponent } from './interfaces/politeness.interface.js';
import type { RevisitComponent } from './interfaces/revisit.interface.js';

type ComponentFactory<T> = (config?: Record<string, any>) => T;

interface ComponentRegistry {
  fetcher:    Record<string, ComponentFactory<FetcherComponent>>;
  parser:     Record<string, ComponentFactory<ParserComponent>>;
  strategy:   Record<string, ComponentFactory<StrategyComponent>>;
  politeness: Record<string, ComponentFactory<PolitenessComponent>>;
  revisit:    Record<string, ComponentFactory<RevisitComponent>>;
}

export const REGISTRY: ComponentRegistry = {
  fetcher: {
    http:     () => new HttpFetcher(),
    headless: () => new HeadlessFetcher(),
  },
  parser: {
    readability: () => new ReadabilityParser(),
    semantic:    () => new SemanticParser(),
  },
  strategy: {
    bfs:     () => new BfsStrategy(),
    focused: (cfg) => { const s = new FocusedStrategy(); s.init(cfg ?? {}); return s; },
  },
  politeness: {
    standard: () => new StandardPoliteness(),
  },
  revisit: {
    none: () => new NoRevisit(),
  },
};

// Extension point for third-party components
export function registerComponent<T>(
  type: keyof ComponentRegistry,
  name: string,
  factory: ComponentFactory<T>
) {
  (REGISTRY[type] as Record<string, ComponentFactory<T>>)[name] = factory;
}

export interface LoadedComponents {
  fetcher:    FetcherComponent;
  parser:     ParserComponent;
  strategy:   StrategyComponent;
  politeness: PolitenessComponent;
  revisit:    RevisitComponent;
}

// Called by worker at job start — assembles all components from job config
export async function loadComponents(config: {
  fetcher:    string;
  parser:     string;
  strategy:   string;
  politeness: string;
  revisit:    string;
  strategyConfig?:   Record<string, any>;
  politenessConfig?: Record<string, any>;
  revisitConfig?:    Record<string, any>;
}): Promise<LoadedComponents> {
  const fetcher    = REGISTRY.fetcher[config.fetcher]?.();
  const parser     = REGISTRY.parser[config.parser]?.();
  const strategy   = REGISTRY.strategy[config.strategy]?.(config.strategyConfig);
  const politeness = REGISTRY.politeness[config.politeness]?.();
  const revisit    = REGISTRY.revisit[config.revisit]?.();

  if (!fetcher)    throw new Error(`Unknown fetcher: ${config.fetcher}`);
  if (!parser)     throw new Error(`Unknown parser: ${config.parser}`);
  if (!strategy)   throw new Error(`Unknown strategy: ${config.strategy}`);
  if (!politeness) throw new Error(`Unknown politeness: ${config.politeness}`);
  if (!revisit)    throw new Error(`Unknown revisit: ${config.revisit}`);

  // Run init on all components in parallel
  await Promise.all([
    fetcher.init?.({}),
    parser.init?.({}),
    politeness.init?.(config.politenessConfig ?? {}),
    revisit.init?.(config.revisitConfig ?? {}),
  ]);

  return { fetcher, parser, strategy, politeness, revisit };
}