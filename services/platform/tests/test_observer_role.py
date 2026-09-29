import unittest

from fastapi import HTTPException

from app.auth import AuthUser, require_admin


class ObserverRoleTests(unittest.TestCase):
    def test_observer_can_open_admin(self) -> None:
        require_admin(AuthUser("u", None, ["pdf-observer"], False, True))

    def test_user_cannot_open_admin(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            require_admin(AuthUser("u", None, ["pdf-user"], False, False))
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
