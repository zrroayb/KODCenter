from setuptools import find_packages, setup


setup(
    name="kod-center-render-compat",
    version="0.1.0",
    packages=find_packages("pycompat"),
    package_dir={"": "pycompat"},
    entry_points={
        "console_scripts": [
            "tradebot-web=tradebot_web_compat.server:main",
        ],
    },
)
