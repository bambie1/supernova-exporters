import {
  Supernova,
  PulsarContext,
  RemoteVersionIdentifier,
  AnyOutputFile,
  TokenType,
  TokenTheme,
  Token
} from "@supernovaio/sdk-exporters"
import { ExporterConfiguration, ThemeExportStyle } from "../config"
import { combinedStyleOutputFileWithCollection } from "./files/style-file"
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

/**
 * Main export function that generates CSS files from design tokens
 *
 * This function handles:
 * - Fetching tokens and token groups from the design system
 * - Filtering tokens by brand if specified
 * - Processing themes in different modes (direct, separate files, or combined)
 * - Generating style files for each token type
 *
 * @param sdk - Supernova SDK instance
 * @param context - Export context containing design system information
 * @returns Promise resolving to an array of output files
 */
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

  // Filter by brand if specified
  if (context.brandId) {
    const brands = await sdk.brands.getBrands(remoteVersionIdentifier)
    const brand = brands.find((brand) => brand.id === context.brandId || brand.idInVersion === context.brandId)
    if (!brand) {
      throw new Error(`Unable to find brand ${context.brandId}.`)
    }

    tokens = tokens.filter((token) => token.brandId === brand.id)
    tokenGroups = tokenGroups.filter((tokenGroup) => tokenGroup.brandId === brand.id)
  }

  const themes = await sdk.tokens.getTokenThemes(remoteVersionIdentifier)
  // themesToApply: light and dark
  const semanticThemesToApply = themes.filter(
    (theme) => (theme.codeName === "light" || theme.codeName === "dark") && theme.brandId === context.brandId
  )
  const gridThemesToApply = themes.filter(
    (theme) => (theme.codeName === "desktop" || theme.codeName === "mobile") && theme.brandId === context.brandId
  )

  const getTokensByCollection = (collectionName: string) => {
    return tokens.filter(
      (token) =>
        tokenCollections.find((collection) => collection.persistentId === token.collectionId)?.name === collectionName
    )
  }

  const generateNestedFile = (theme: TokenTheme, nicheTokens: Array<Token>, collectionName: string) => {
    const themeFiles = gridThemesToApply.map((gridTheme) => {
      // Apply the current theme to all tokens
      const themedTokens = sdk.tokens.computeTokensByApplyingThemes(tokens, nicheTokens, [theme, gridTheme])

      // temporarily set export as to nested themes for the semantic grid
      const originalExportAs = exportConfiguration.exportThemesAs
      exportConfiguration.exportThemesAs = ThemeExportStyle.NestedThemes

      // Generate the themed version of all tokens
      const file = combinedStyleOutputFileWithCollection(
        themedTokens,
        tokenGroups,
        collectionName,
        gridTheme,
        tokenCollections,
        theme.codeName
      )

      // restore the original export as
      exportConfiguration.exportThemesAs = originalExportAs

      return file
    })

    // Step 3: Merge all generated files (base + themed) into a single output
    // The merge preserves the nested structure while combining base and themed values
    const mergedFile = themeFiles.reduce((merged, file) => {
      if (!file) return merged
      if (!merged) return file

      // Deep merge preserves the nested structure and combines theme variations
      const mergedContent = deepMerge(JSON.parse(merged.content), JSON.parse(file.content))

      // Return a new file with merged content
      return {
        ...file,
        content: JSON.stringify(mergedContent, null, exportConfiguration.indent)
      }
    }, null)

    return [mergedFile]
  }

  const generateNormalFile = (theme: TokenTheme, nicheTokens: Array<Token>, collectionName: string) => {
    const themedTokens = sdk.tokens.computeTokensByApplyingThemes(tokens, nicheTokens, [theme])

    return combinedStyleOutputFileWithCollection(
      themedTokens,
      tokenGroups,
      collectionName,
      theme,
      tokenCollections,
      theme.codeName
    )
  }

  const semanticThemeTokens = getTokensByCollection("semanticTheme")
  const semanticTypeTokens = getTokensByCollection("semanticType")
  const semanticBrandTokens = getTokensByCollection("semanticBrand")
  const semanticGridTokens = getTokensByCollection("semanticGrid")
  const componentWebTokens = getTokensByCollection("componentWeb")

  const componentWebColorTokens = componentWebTokens.filter(({ tokenType }) => tokenType === TokenType.color)
  const componentWebNonColorTokens = componentWebTokens.filter(({ tokenType }) => tokenType !== TokenType.color)

  const semanticThemeFiles = semanticThemesToApply.map((theme) =>
    generateNormalFile(theme, semanticThemeTokens, "semanticTheme")
  )

  const semanticTypeFiles = semanticThemesToApply.map((theme) =>
    generateNormalFile(theme, semanticTypeTokens, "semanticType")
  )

  const semanticBrandFiles = semanticThemesToApply.map((theme) =>
    generateNormalFile(theme, semanticBrandTokens, "semanticBrand")
  )

  const componentWebColorFiles = semanticThemesToApply.map((theme) =>
    generateNormalFile(theme, componentWebColorTokens, "componentWeb-color")
  )

  const componentWebNonColorFiles = semanticThemesToApply.flatMap((semanticTheme) =>
    generateNestedFile(semanticTheme, componentWebNonColorTokens, "componentWeb")
  )

  const semanticGridFiles = semanticThemesToApply.flatMap((semanticTheme) =>
    generateNestedFile(semanticTheme, semanticGridTokens, "semanticGrid")
  )

  return processOutputFiles([
    ...semanticThemeFiles,
    ...semanticTypeFiles,
    ...semanticBrandFiles,
    ...semanticGridFiles,
    ...componentWebColorFiles,
    ...componentWebNonColorFiles
  ])
})
