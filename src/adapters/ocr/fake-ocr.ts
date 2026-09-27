import type { Ocr, OcrBox, OcrInput, OcrOutput } from "./port";

export class FakeOcr implements Ocr {
  readonly calls: OcrInput[] = [];
  private readonly boxes: OcrBox[];
  private readonly unreachable: boolean;

  constructor(options?: {
    boxes?: OcrBox[];
    unreachable?: boolean;
  }) {
    this.boxes = options?.boxes ?? [];
    this.unreachable = options?.unreachable ?? false;
  }

  async recognize(input: OcrInput): Promise<OcrOutput> {
    this.calls.push(input);
    if (this.unreachable) {
      throw new Error("OCR is unreachable.");
    }
    return { boxes: [...this.boxes], durationMs: 0 };
  }
}

export function unreachableFakeOcr(): Ocr {
  return new FakeOcr({ unreachable: true });
}
