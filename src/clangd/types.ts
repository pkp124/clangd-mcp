export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspLocation = {
  uri: string;
  range: LspRange;
  containerName?: string;
};

export type LspTextDocumentIdentifier = {
  uri: string;
};

export type SymbolKind = number;

export type SymbolInformation = {
  name: string;
  kind: SymbolKind;
  containerName?: string;
  location: LspLocation;
};

export type DocumentSymbol = {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: DocumentSymbol[];
};

export type SymbolDetails = {
  name: string;
  containerName?: string;
  usr?: string;
  id?: string;
};

export type HoverResult = {
  contents: unknown;
  range?: LspRange;
};

export type Diagnostic = {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  category?: string;
};

export type CallHierarchyItem = {
  name: string;
  kind: SymbolKind;
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  detail?: string;
  data?: unknown;
};

export type CallHierarchyIncomingCall = {
  from: CallHierarchyItem;
  fromRanges: LspRange[];
};

export type CallHierarchyOutgoingCall = {
  to: CallHierarchyItem;
  fromRanges: LspRange[];
};

export type TypeHierarchyItem = {
  name: string;
  kind: SymbolKind;
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  detail?: string;
  data?: unknown;
};

export type AstNode = {
  role: string;
  kind: string;
  detail?: string;
  arcana?: string;
  range?: LspRange;
  children?: AstNode[];
};

export type FileStatus = {
  uri: string;
  state: string;
};

export type TypeHierarchyDirection = "parents" | "children" | "both";

export type IndexSource =
  | { kind: "file"; path: string }
  | { kind: "remote"; address: string; mountPoint: string };
