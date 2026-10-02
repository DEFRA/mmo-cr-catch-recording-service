export function assertRequiredDependency(ownerName, dependencyName, value) {
  if (value === undefined || value === null) {
    throw new Error(`${ownerName} requires a "${dependencyName}" dependency`)
  }
}
