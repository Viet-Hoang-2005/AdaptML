import pandas as pd

from unittest.mock import Mock
from src import database

class Context:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, *args):
        return False


def test_create_engine_safe_quotes_password(monkeypatch):
    monkeypatch.setattr(database, "DB_USER", "user")
    monkeypatch.setattr(database, "DB_PASSWORD", "p@ss word")
    create = Mock(return_value="engine")
    monkeypatch.setattr(database, "create_engine", create)
    assert database.create_engine_safe("db", "RW") == "engine"
    assert "p%40ss+word" in create.call_args.args[0]


def test_create_engine_safe_failure_returns_none(monkeypatch):
    monkeypatch.setattr(database, "create_engine", Mock(side_effect=RuntimeError("bad")))
    assert database.create_engine_safe("db", "RW") is None


def test_save_dataframe_handles_no_engine(monkeypatch):
    monkeypatch.setattr(database, "engine_rw", None)
    assert not database.save_dataframe_to_db(pd.DataFrame({"id": ["1"]}), "logs")


def test_save_dataframe_marks_nested_columns_jsonb(monkeypatch):
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = ("pk",)
    engine = Mock()
    engine.begin.return_value = Context(connection)
    monkeypatch.setattr(database, "engine_rw", engine)
    df = pd.DataFrame({"id": ["1"], "features": [{"x": 1}], "prediction": ["ok"]})
    to_sql = Mock()
    monkeypatch.setattr(pd.DataFrame, "to_sql", to_sql)
    assert database.save_dataframe_to_db(df, "logs")
    assert to_sql.call_args.kwargs["dtype"]["features"] is database.JSONB
    assert df.loc[0, "features"] == {"x": 1}


def test_save_dataframe_exception_returns_false(monkeypatch):
    monkeypatch.setattr(database, "engine_rw", Mock())
    monkeypatch.setattr(pd.DataFrame, "to_sql", Mock(side_effect=RuntimeError("db")))
    assert not database.save_dataframe_to_db(pd.DataFrame({"id": ["1"]}), "logs")


def test_count_queries_and_fallback(monkeypatch):
    result = Mock()
    result.scalar.return_value = 7
    conn = Mock()
    conn.execute.return_value = result
    engine = Mock()
    engine.connect.return_value = Context(conn)
    monkeypatch.setattr(database, "engine_ro", engine)
    monkeypatch.setattr(database, "engine_rw", None)
    assert database.get_production_data_count() == 7
    assert database.get_production_data_count_by_model("m") == 7
    assert conn.execute.call_args.args[1] == {"model_id": "m"}


def test_count_without_engine_returns_zero(monkeypatch):
    monkeypatch.setattr(database, "engine_ro", None)
    monkeypatch.setattr(database, "engine_rw", None)
    assert database.get_production_data_count() == 0
    assert database.get_production_data_count_by_model("m") == 0


def test_get_drift_thresholds(monkeypatch):
    rows = [("v1", 100), ("v2", 250)]
    result = Mock()
    result.fetchall.return_value = rows
    conn = Mock()
    conn.execute.return_value = result
    engine = Mock()
    engine.connect.return_value = Context(conn)
    monkeypatch.setattr(database, "engine_ro", engine)
    assert database.get_model_drift_thresholds() == {"v1": 100, "v2": 250}
