import PruneCommand from '../../commands/prune.ts'
import RoutesCommand from '../../commands/routes.ts'
import StatusCommand from '../../commands/status.ts'
import StopCommand from '../../commands/stop.ts'

type CommandMetadata = ReturnType<typeof PruneCommand.serialize>
const commands = [PruneCommand, RoutesCommand, StatusCommand, StopCommand]

/** Metadata consumed by AdonisJS Ace command discovery. */
export async function getMetaData(): Promise<CommandMetadata[]> {
  return commands.map((command) => command.serialize())
}

/** Resolve the registered command by the same contract used by AdonisJS core. */
export async function getCommand(metaData: CommandMetadata) {
  return commands.find((command) => command.commandName === metaData.commandName) ?? null
}
