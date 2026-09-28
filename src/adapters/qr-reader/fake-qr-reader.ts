import type { QrDecodeInput, QrReadOptions, QrReader } from "./port";

export class FakeQrReader implements QrReader {
  readonly calls: QrDecodeInput[] = [];
  private readonly codesByCall: string[][];

  constructor(codesByCall: string[][]) {
    this.codesByCall = codesByCall;
  }

  readonly options: Array<QrReadOptions | undefined> = [];

  async readAllCodes(input: QrDecodeInput, options?: QrReadOptions): Promise<string[]> {
    this.calls.push(input);
    this.options.push(options);
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
