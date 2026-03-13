export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MissingEnvError extends AppError {
  constructor(name: string) {
    super(`Missing ${name} environment variable`, "MISSING_ENV");
  }
}

export class UnsupportedModelError extends AppError {
  constructor() {
    super(
      "Selected model does not support Structured Outputs (json_schema). Choose a compatible model.",
      "UNSUPPORTED_MODEL",
    );
  }
}

export class ModelRefusalError extends AppError {
  constructor(reason: string) {
    super(`Model refused structured output: ${reason.trim()}`, "MODEL_REFUSAL");
  }
}

export class DryRunAbortError extends AppError {
  constructor() {
    super("Dry run: request not sent", "DRY_RUN_ABORT");
  }
}
