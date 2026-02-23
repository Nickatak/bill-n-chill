#!/bin/sh
set -eu

# Ensure the app user can create/drop Django test databases.
# This runs during first-time MySQL container initialization.
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
GRANT CREATE, DROP ON *.* TO '${MYSQL_USER}'@'%';
GRANT ALL PRIVILEGES ON test_bill_n_chill.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
