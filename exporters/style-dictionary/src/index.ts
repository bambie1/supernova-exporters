import {
  Supernova,
  PulsarContext,
  RemoteVersionIdentifier,
  AnyOutputFile,
  TokenType,
  Token
} from "@supernovaio/sdk-exporters"
import { ExporterConfiguration, ThemeExportStyle, FileStructure } from "../config"
import { styleOutputFile } from "./files/style-file"
import { StringCase, ThemeHelper } from "@supernovaio/export-utils"
import { deepMerge } from "./utils/token-hierarchy"

/** Exporter configuration from the resolved default configuration and user overrides */
export const exportConfiguration = Pulsar.exportConfig<ExporterConfiguration>()

/**
 * Filters out null values from an array of output files
 * @param files Array of output files that may contain null values
 * @returns Array of non-null output files
 */
function processOutputFiles(files: Array<AnyOutputFile | null>): Array<AnyOutputFile> {
  return files.filter((file): file is AnyOutputFile => file !== null)
}

Pulsar.export(async (sdk: Supernova, context: PulsarContext): Promise<Array<AnyOutputFile>> => {
  // Fetch data from design system that is currently being exported
  const remoteVersionIdentifier: RemoteVersionIdentifier = {
    designSystemId: context.dsId,
    versionId: context.versionId
  }

  // Fetch tokens, groups and collections
  let tokens = await sdk.tokens.getTokens(remoteVersionIdentifier)
  let tokenGroups = await sdk.tokens.getTokenGroups(remoteVersionIdentifier)
  let tokenCollections = await sdk.tokens.getTokenCollections(remoteVersionIdentifier)
  let brandName: string | null = null

  // Filter by brand if specified
  if (context.brandId) {
    const brands = await sdk.brands.getBrands(remoteVersionIdentifier)
    const brand = brands.find((brand) => brand.id === context.brandId || brand.idInVersion === context.brandId)
    if (!brand) {
      throw new Error(`Unable to find brand ${context.brandId}.`)
    }
    brandName = brand.name
    tokens = tokens.filter((token) => token.brandId === brand.id)
    tokenGroups = tokenGroups.filter((tokenGroup) => tokenGroup.brandId === brand.id)
  }

  // Process themes if specified
  const themes = await sdk.tokens.getTokenThemes(remoteVersionIdentifier)

  // Use selected themes if specified, otherwise use all available themes
  const themesToApply =
    context.themeIds && context.themeIds.length > 0
      ? context.themeIds.map((themeId) => {
          const theme = themes.find((theme) => theme.id === themeId || theme.idInVersion === themeId)
          if (!theme) {
            throw new Error(`Unable to find theme ${themeId}`)
          }
          return theme
        })
      : themes

  // Process themes based on the selected export style
  switch (exportConfiguration.exportThemesAs) {
    case ThemeExportStyle.NestedThemes:
      const valueObjectFiles = Object.values(TokenType).map((type) => {
        // Then create files for each theme
        const themeFiles = themesToApply.map((theme) => {
          const themedTokens = sdk.tokens.computeTokensByApplyingThemes(tokens, tokens, [theme])

          const expandedThemedTokens = themedTokens.map(
            (token) =>
              ({
                ...token,
                collectionId: tokens.find((t) => t.id === token.id)?.collectionId
              }) as Token
          )

          // Pass false for exportBaseValues to prevent including base values in theme files
          const originalExportBaseValues = exportConfiguration.exportBaseValues
          exportConfiguration.exportBaseValues = false
          const file = styleOutputFile(type, expandedThemedTokens, tokenGroups, "", theme, tokenCollections, brandName)
          exportConfiguration.exportBaseValues = originalExportBaseValues
          return file
        })

        // Merge all files, starting with the base file
        return themeFiles.reduce((merged, file) => {
          if (!file) return merged
          if (!merged) return file

          // Merge the content
          const mergedContent = deepMerge(JSON.parse(merged.content), JSON.parse(file.content))

          // Return a new file with merged content
          return {
            ...file,
            content: JSON.stringify(mergedContent, null, exportConfiguration.indent)
          }
        }, null)
      })
      return processOutputFiles(valueObjectFiles)

    case ThemeExportStyle.SeparateFiles:
      const themeFiles = themesToApply.flatMap((theme) => {
        const themedTokens = sdk.tokens.computeTokensByApplyingThemes(tokens, tokens, [theme])
        const themePath = ThemeHelper.getThemeIdentifier(theme, StringCase.camelCase)
        return Object.values(TokenType).map((type) =>
          styleOutputFile(type, themedTokens, tokenGroups, themePath, theme, tokenCollections, brandName)
        )
      })

      const baseFiles = exportConfiguration.exportBaseValues
        ? Object.values(TokenType).map((type) =>
            styleOutputFile(type, tokens, tokenGroups, "", undefined, tokenCollections, brandName)
          )
        : []

      return processOutputFiles([...baseFiles, ...themeFiles])
  }

  return processOutputFiles([])
})
