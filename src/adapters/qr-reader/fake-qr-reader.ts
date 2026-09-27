import type { QrDecodeInput, QrReader } from "./port";

export class FakeQrReader implements QrReader {
  readonly calls: QrDecodeInput[] = [];
  private readonly codesByCall: string[][];

  constructor(codesByCall: string[][]) {
    this.codesByCall = codesByCall;
  }

  async readAllCodes(input: QrDecodeInput): Promise<string[]> {
    this.calls.push(input);
    const index = this.calls.length - 1;
    return this.codesByCall[index] ?? [];
  }
}

export function emptyQrReader(): QrReader {
  return {
    async readAllCodes() {
      return [];
    },
  };
}
