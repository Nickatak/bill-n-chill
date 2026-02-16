try:
    import pymysql

    pymysql.version_info = (2, 2, 1, "final", 0)
    pymysql.install_as_MySQLdb()
except ImportError:
    # PyMySQL is optional until MySQL-backed workflows are used.
    pass
