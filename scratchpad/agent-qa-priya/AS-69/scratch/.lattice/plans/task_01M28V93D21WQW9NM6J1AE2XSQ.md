# AS-114: Chat watcher: parseDockerignore accepts ./lib, lib/../lib and . — BuildKit cleans them to real paths, so a COPY-shrinking .dockerignore line passes the hides-no-input guard (AS-86 Priya F1)
