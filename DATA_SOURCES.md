# Data sources

All data is read at call time from the fueleconomy.gov web services, run by the U.S. Department of Energy with data from the U.S. Environmental Protection Agency. No key is needed.

| Endpoint | Used for |
| --- | --- |
| `https://www.fueleconomy.gov/ws/rest/vehicle/menu/year` | model years |
| `https://www.fueleconomy.gov/ws/rest/vehicle/menu/make?year=Y` | makes for a year |
| `https://www.fueleconomy.gov/ws/rest/vehicle/menu/model?year=Y&make=M` | models for a make |
| `https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=Y&make=M&model=X` | versions and their vehicle ids |
| `https://www.fueleconomy.gov/ws/rest/vehicle/<id>` | the EPA vehicle record: MPG, MPGe, kWh/100 mi, range, annual fuel cost, CO2, scores |
| `https://www.fueleconomy.gov/ws/rest/ympg/shared/ympgVehicle/<id>` | My MPG driver reports (read only when the record says there are some) |
| `https://www.fueleconomy.gov/ws/rest/fuelprices` | national average fuel and electricity prices |

The EPA annual fuel cost assumes 15,000 miles a year with 55% city driving. Plug-in hybrid blends use the EPA utility factor (`combinedUF`), the share of miles driven on electricity.

fueleconomy.gov data is a U.S. government work and is in the public domain.
