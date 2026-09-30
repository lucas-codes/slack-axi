import { parse, wantsJson } from './args.ts';
import { Failure } from './errors.ts';
import { HELP } from './help.ts';
import { Cleaner, serialize } from './output.ts';
import { execute } from './slack.ts';
import { credential } from './transport.ts';

export async function run(argv: string[], env: { SLACK_AXI_TOKEN?: string } = process.env): Promise<{stdout: string; exitCode: number}> {
  const captured = env.SLACK_AXI_TOKEN ?? '';
  const cleaner = new Cleaner(captured);
  let json = wantsJson(argv);
  try {
    const args = parse(argv);
    json = args.json;
    if (args.help) return {stdout:cleaner.redact(HELP),exitCode:0};
    if (args.version) return {stdout:'slack-axi 0.1.0\n',exitCode:0};
    const data = await execute(args,credential(captured),cleaner);
    return {stdout:serialize(data,json,cleaner),exitCode:0};
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure('Unexpected command failure.', 'internal');
    return {
      stdout:serialize({error:cleaner.field(failure.message,'error',200),code:failure.code,retry_after:failure.retryAfter,help:['Run `slack-axi --help`']},json,cleaner),
      exitCode:failure.exitCode,
    };
  }
}
