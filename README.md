# Data Heaving - Common
[![Code Coverage](https://codecov.io/gh/DataHeaving/cloud-azure/branch/develop/graph/badge.svg)](https://codecov.io/gh/DataHeaving/cloud-azure)

This repository is part of [Data Heaving project](https://github.com/DataHeaving).
There are multiple packages in the repository, all of which contain QoL API to work within Azure environment:
- [Identity](identity) package contains API and implementation to get instance of `TokenCredential` which is either environment-based, or managed identity -based,
- [Storage BLOB](storage-blob) package implements the `ObjectStorageFunctionality` interface defined by [DataHeaving common package](https://github.com/DataHeaving/common/common) as (de)serializing it from/to Azure Storage BLOB, and
- [Key vault secret](kv-secret) package contains helper methods to retrieve a secret (values) from Azure Key Vault.

# Usage
All packages of Data Heaving project are published as NPM packages to public NPM repository under `@data-heaving` organization.

# More information
To learn more what Data Heaving project is all about, [see here](https://github.com/DataHeaving/orchestration).