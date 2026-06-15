export function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [flag, inlineValue] = token.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const takesValue = ["--config", "--cwd", "--against", "--target", "--changed", "--mode", "--since", "--output"].includes(flag);

    if (!takesValue) {
      args[flag.slice(2)] = true;
      continue;
    }

    args[flag.slice(2)] = nextValue;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return args;
}

export async function executeRoutedCommand(command, handlers) {
  const handler = handlers[command];

  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }

  return await handler();
}
