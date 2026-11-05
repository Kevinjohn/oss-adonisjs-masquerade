type ParsedStableVersion = {
  version: string
  components: [number, number, number]
}

/** Select the greatest canonical stable x.y.z version from a range-filtered registry result. */
export function selectRegistryVersion(packageName: string, listed: unknown): string {
  const candidates = Array.isArray(listed) ? listed : [listed]
  if (candidates.length === 0) throw new Error(`Registry returned no versions for ${packageName}`)

  const parsed = candidates.map((candidate, index) =>
    parseStableVersion(packageName, candidate, index)
  )
  return parsed.reduce((greatest, current) =>
    compareComponents(current.components, greatest.components) > 0 ? current : greatest
  ).version
}

function parseStableVersion(
  packageName: string,
  value: unknown,
  index: number
): ParsedStableVersion {
  const context = `Registry version ${index + 1} for ${packageName}`
  if (typeof value !== 'string') throw new Error(`${context} must be a string`)
  if (/^\d+\.\d+\.\d+-/.test(value))
    throw new Error(
      `${context} is a prerelease (${value}); only stable x.y.z versions are supported`
    )
  if (/^\d+\.\d+\.\d+\+/.test(value))
    throw new Error(
      `${context} has build metadata (${value}); only stable x.y.z versions are supported`
    )

  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match)
    throw new Error(`${context} is not a canonical stable x.y.z version: ${value || '(empty)'}`)

  const components = match.slice(1).map(Number)
  if (components.some((component) => !Number.isSafeInteger(component)))
    throw new Error(`${context} has a component outside the safe integer range: ${value}`)

  return { version: value, components: components as [number, number, number] }
}

function compareComponents(left: [number, number, number], right: [number, number, number]) {
  for (const [index, component] of left.entries()) {
    if (component !== right[index]) return component > right[index] ? 1 : -1
  }
  return 0
}
