import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'

export const versionGraph = VersionGraph.of({
  current,
  // Declare an earlier version only while a later release migrates from it.
  other: [],
})
