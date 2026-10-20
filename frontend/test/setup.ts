import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The full suite runs files in parallel; the default 1s wait for async UI was flaky
// under that load (seen with the chat workspace). Failures still fail, just later.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
});
